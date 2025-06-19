import * as errors from "@/worker/errors";
import * as cbor from "cbor-x";
import type * as protoHttpResolve from "@/worker/protocol/http/resolve";
import type { ToClient } from "@/worker/protocol/message/to-client";
import {
	type Encoding,
	EncodingSchema,
	serialize,
} from "@/worker/protocol/serde";
import {
	type ConnectionHandlers,
	getRequestEncoding,
	handleConnectionMessage,
	handleAction,
	handleSseConnect,
	handleWebSocketConnect,
	HEADER_WORKER_ID,
	HEADER_CONN_ID,
	HEADER_CONN_PARAMS,
	HEADER_CONN_TOKEN,
	HEADER_ENCODING,
	HEADER_WORKER_QUERY,
	ALL_PUBLIC_HEADERS,
	getRequestQuery,
	HEADER_AUTH_DATA,
} from "@/worker/router-endpoints";
import { assertUnreachable } from "@/worker/utils";
import type { RegistryConfig } from "@/registry/config";
import {
	handleRouteError,
	handleRouteNotFound,
	loggerMiddleware,
} from "@/common/router";
import {
	DeconstructedError,
	deconstructError,
	stringifyError,
} from "@/common/utils";
import type { DriverConfig } from "@/driver-helpers/config";
import { Hono, type Context as HonoContext, type Next } from "hono";
import { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import type { WSContext } from "hono/ws";
import invariant from "invariant";
import type { ManagerDriver } from "./driver";
import { logger } from "./log";
import {
	ConnectRequestSchema,
	ConnectWebSocketRequestSchema,
	ConnMessageRequestSchema,
	ResolveRequestSchema,
} from "./protocol/query";
import type { WorkerQuery } from "./protocol/query";
import { VERSION } from "@/utils";
import { ConnRoutingHandler } from "@/worker/conn-routing-handler";
import { ClientDriver } from "@/client/client";
import { Transport } from "@/worker/protocol/message/mod";
import { authenticateEndpoint } from "./auth";
import type { WebSocket, MessageEvent, CloseEvent } from "ws";

type ManagerRouterHandler = {
	// onConnectInspector?: ManagerInspectorConnHandler;
	routingHandler: ConnRoutingHandler;
};

const OPENAPI_ENCODING = z.string().openapi({
	description: "The encoding format to use for the response (json, cbor)",
	example: "json",
});

const OPENAPI_WORKER_QUERY = z.string().openapi({
	description: "Worker query information",
});

const OPENAPI_CONN_PARAMS = z.string().openapi({
	description: "Connection parameters",
});

const OPENAPI_WORKER_ID = z.string().openapi({
	description: "Worker ID (used in some endpoints)",
	example: "worker-123456",
});

const OPENAPI_CONN_ID = z.string().openapi({
	description: "Connection ID",
	example: "conn-123456",
});

const OPENAPI_CONN_TOKEN = z.string().openapi({
	description: "Connection token",
});

function buildOpenApiResponses<T>(schema: T) {
	return {
		200: {
			description: "Success",
			content: {
				"application/json": {
					schema,
				},
			},
		},
		400: {
			description: "User error",
		},
		500: {
			description: "Internal error",
		},
	};
}

export function createManagerRouter(
	registryConfig: RegistryConfig,
	driverConfig: DriverConfig,
	inlineClientDriver: ClientDriver,
	handler: ManagerRouterHandler,
) {
	if (!driverConfig.drivers?.manager) {
		// FIXME move to config schema
		throw new Error("config.drivers.manager is not defined.");
	}
	const driver = driverConfig.drivers.manager;
	const router = new OpenAPIHono();

	const upgradeWebSocket = driverConfig.getUpgradeWebSocket?.(
		router as unknown as Hono,
	);

	router.use("*", loggerMiddleware(logger()));

	if (registryConfig.cors) {
		const corsConfig = registryConfig.cors;

		router.use("*", async (c, next) => {
			const path = c.req.path;

			// Don't apply to WebSocket routes
			if (path === "/workers/connect/websocket" || path === "/inspect") {
				return next();
			}

			return cors({
				...corsConfig,
				allowHeaders: [
					...(registryConfig.cors?.allowHeaders ?? []),
					...ALL_PUBLIC_HEADERS,
				],
			})(c, next);
		});
	}

	// GET /
	router.get("/", (c) => {
		return c.text(
			"This is an RivetKit server.\n\nLearn more at https://rivetkit.org",
		);
	});

	// GET /health
	router.get("/health", (c) => {
		return c.text("ok");
	});

	// POST /workers/resolve
	{
		const ResolveQuerySchema = z
			.object({
				query: z.any().openapi({
					example: { getForId: { workerId: "worker-123" } },
				}),
			})
			.openapi("ResolveQuery");

		const ResolveResponseSchema = z
			.object({
				i: z.string().openapi({
					example: "worker-123",
				}),
			})
			.openapi("ResolveResponse");

		const resolveRoute = createRoute({
			method: "post",
			path: "/workers/resolve",
			request: {
				body: {
					content: {
						"application/json": {
							schema: ResolveQuerySchema,
						},
					},
				},
				headers: z.object({
					[HEADER_WORKER_QUERY]: OPENAPI_WORKER_QUERY,
				}),
			},
			responses: buildOpenApiResponses(ResolveResponseSchema),
		});

		router.openapi(resolveRoute, (c) =>
			handleResolveRequest(c, registryConfig, driver),
		);
	}

	// GET /workers/connect/websocket
	{
		const wsRoute = createRoute({
			method: "get",
			path: "/workers/connect/websocket",
			responses: {
				101: {
					description: "WebSocket upgrade",
				},
			},
		});

		router.openapi(wsRoute, (c) =>
			handleWebSocketConnectRequest(
				c,
				upgradeWebSocket,
				registryConfig,
				driverConfig,
				driver,
				handler,
			),
		);
	}

	// GET /workers/connect/sse
	{
		const sseRoute = createRoute({
			method: "get",
			path: "/workers/connect/sse",
			request: {
				headers: z.object({
					[HEADER_ENCODING]: OPENAPI_ENCODING,
					[HEADER_WORKER_QUERY]: OPENAPI_WORKER_QUERY,
					[HEADER_CONN_PARAMS]: OPENAPI_CONN_PARAMS.optional(),
				}),
			},
			responses: {
				200: {
					description: "SSE stream",
					content: {
						"text/event-stream": {
							schema: z.unknown(),
						},
					},
				},
			},
		});

		router.openapi(sseRoute, (c) =>
			handleSseConnectRequest(c, registryConfig, driverConfig, driver, handler),
		);
	}

	// POST /workers/action/:action
	{
		const ActionParamsSchema = z
			.object({
				action: z.string().openapi({
					param: {
						name: "action",
						in: "path",
					},
					example: "myAction",
				}),
			})
			.openapi("ActionParams");

		const ActionRequestSchema = z
			.object({
				query: z.any().openapi({
					example: { getForId: { workerId: "worker-123" } },
				}),
				body: z
					.any()
					.optional()
					.openapi({
						example: { param1: "value1", param2: 123 },
					}),
			})
			.openapi("ActionRequest");

		const ActionResponseSchema = z.any().openapi("ActionResponse");

		const actionRoute = createRoute({
			method: "post",
			path: "/workers/actions/{action}",
			request: {
				params: ActionParamsSchema,
				body: {
					content: {
						"application/json": {
							schema: ActionRequestSchema,
						},
					},
				},
				headers: z.object({
					[HEADER_ENCODING]: OPENAPI_ENCODING,
					[HEADER_CONN_PARAMS]: OPENAPI_CONN_PARAMS.optional(),
				}),
			},
			responses: buildOpenApiResponses(ActionResponseSchema),
		});

		router.openapi(actionRoute, (c) =>
			handleActionRequest(c, registryConfig, driverConfig, driver, handler),
		);
	}

	// POST /workers/message
	{
		const ConnectionMessageRequestSchema = z
			.object({
				message: z.any().openapi({
					example: { type: "message", content: "Hello, worker!" },
				}),
			})
			.openapi("ConnectionMessageRequest");

		const ConnectionMessageResponseSchema = z
			.any()
			.openapi("ConnectionMessageResponse");

		const messageRoute = createRoute({
			method: "post",
			path: "/workers/message",
			request: {
				body: {
					content: {
						"application/json": {
							schema: ConnectionMessageRequestSchema,
						},
					},
				},
				headers: z.object({
					[HEADER_WORKER_ID]: OPENAPI_WORKER_ID,
					[HEADER_CONN_ID]: OPENAPI_CONN_ID,
					[HEADER_ENCODING]: OPENAPI_ENCODING,
					[HEADER_CONN_TOKEN]: OPENAPI_CONN_TOKEN,
				}),
			},
			responses: buildOpenApiResponses(ConnectionMessageResponseSchema),
		});

		router.openapi(messageRoute, (c) =>
			handleMessageRequest(c, registryConfig, handler),
		);
	}

	// if (registryConfig.inspector.enabled) {
	// 	router.route(
	// 		"/inspect",
	// 		createManagerInspectorRouter(
	// 			upgradeWebSocket,
	// 			handler.onConnectInspector,
	// 			registryConfig.inspector,
	// 		),
	// 	);
	// }

	if (registryConfig.test.enabled) {
		// Add HTTP endpoint to test the inline client
		//
		// We have to do this in a router since this needs to run in the same server as the RivetKit registry. Some test contexts to not run in the same server.
		router.post(".test/inline-driver/call", async (c) => {
			// TODO: use openapi instead
			const buffer = await c.req.arrayBuffer();
			const { encoding, transport, method, args }: TestInlineDriverCallRequest =
				cbor.decode(new Uint8Array(buffer));

			logger().info("received inline request", {
				encoding,
				transport,
				method,
				args,
			});

			// Forward inline driver request
			let response: TestInlineDriverCallResponse<unknown>;
			try {
				const output = await ((inlineClientDriver as any)[method] as any)(
					...args,
				);
				response = { ok: output };
			} catch (rawErr) {
				const err = deconstructError(rawErr, logger(), {}, true);
				response = { err };
			}

			return c.body(cbor.encode(response));
		});

		if (upgradeWebSocket) {
			router.get(
				".test/inline-driver/connect-websocket",
				upgradeWebSocket(async (c) => {
					const {
						workerQuery: workerQueryRaw,
						params: paramsRaw,
						encodingKind,
					} = c.req.query() as {
						workerQuery: string;
						params?: string;
						encodingKind: Encoding;
					};
					const workerQuery = JSON.parse(workerQueryRaw);
					const params =
						paramsRaw !== undefined ? JSON.parse(paramsRaw) : undefined;

					logger().debug("received test inline driver websocket", {
						workerQuery,
						params,
						encodingKind,
					});

					// Connect to the worker using the inline client driver - this returns a Promise<WebSocket>
					const clientWsPromise = inlineClientDriver.connectWebSocket(
						undefined,
						workerQuery,
						encodingKind,
						params,
						undefined,
					);

					// Store a reference to the resolved WebSocket
					let clientWs: WebSocket | null = null;

					// Create WebSocket proxy handlers to relay messages between client and server
					return {
						onOpen: async (_evt: any, serverWs: WSContext) => {
							logger().debug("test websocket connection opened");

							try {
								// Resolve the client WebSocket promise
								clientWs = await clientWsPromise;

								// Add message handler to forward messages from client to server
								clientWs.onmessage = (clientEvt: MessageEvent) => {
									logger().debug("test websocket connection message");

									if (serverWs.readyState === 1) {
										// OPEN
										serverWs.send(clientEvt.data as any);
									}
								};

								// Add close handler to close server when client closes
								clientWs.onclose = (clientEvt: CloseEvent) => {
									logger().debug("test websocket connection closed");

									if (serverWs.readyState !== 3) {
										// Not CLOSED
										serverWs.close(clientEvt.code, clientEvt.reason);
									}
								};

								// Add error handler
								clientWs.onerror = () => {
									logger().debug("test websocket connection error");

									if (serverWs.readyState !== 3) {
										// Not CLOSED
										serverWs.close(1011, "Error in client websocket");
									}
								};
							} catch (error) {
								logger().error(
									"failed to establish client websocket connection",
									{ error },
								);
								serverWs.close(1011, "Failed to establish connection");
							}
						},
						onMessage: async (evt: { data: any }, serverWs: WSContext) => {
							// If clientWs hasn't been resolved yet, messages will be lost
							if (!clientWs) {
								logger().debug(
									"received server message before client WebSocket connected",
								);
								return;
							}

							logger().debug("received message from server", {
								dataType: typeof evt.data,
							});

							// Forward messages from server websocket to client websocket
							if (clientWs.readyState === 1) {
								// OPEN
								clientWs.send(evt.data);
							}
						},
						onClose: async (
							event: {
								wasClean: boolean;
								code: number;
								reason: string;
							},
							serverWs: WSContext,
						) => {
							logger().debug("server websocket closed", {
								wasClean: event.wasClean,
								code: event.code,
								reason: event.reason,
							});

							// HACK: Close socket in order to fix bug with Cloudflare leaving WS in closing state
							// https://github.com/cloudflare/workerd/issues/2569
							serverWs.close(1000, "hack_force_close");

							// Close the client websocket when the server websocket closes
							if (
								clientWs &&
								clientWs.readyState !== clientWs.CLOSED &&
								clientWs.readyState !== clientWs.CLOSING
							) {
								clientWs.close(event.code, event.reason);
							}
						},
						onError: async (error: unknown) => {
							logger().error("error in server websocket", { error });

							// Close the client websocket on error
							if (
								clientWs &&
								clientWs.readyState !== clientWs.CLOSED &&
								clientWs.readyState !== clientWs.CLOSING
							) {
								clientWs.close(1011, "Error in server websocket");
							}
						},
					};
				}),
			);
		} else {
			router.get(".test/inline-driver/connect-websocket", (c) => {
				throw new Error(
					"websocket unsupported, fix the test to exclude websockets for this platform",
				);
			});
		}
	}

	router.doc("/openapi.json", {
		openapi: "3.0.0",
		info: {
			version: VERSION,
			title: "RivetKit API",
		},
	});

	router.notFound(handleRouteNotFound);
	router.onError(handleRouteError.bind(undefined, {}));

	return router as unknown as Hono;
}

export interface TestInlineDriverCallRequest {
	encoding: Encoding;
	transport: Transport;
	method: string;
	args: unknown[];
}

export type TestInlineDriverCallResponse<T> =
	| {
			ok: T;
	  }
	| {
			err: DeconstructedError;
	  };

/**
 * Query the manager driver to get or create a worker based on the provided query
 */
export async function queryWorker(
	c: HonoContext,
	query: WorkerQuery,
	driver: ManagerDriver,
): Promise<{ workerId: string }> {
	logger().debug("querying worker", { query });
	let workerOutput: { workerId: string };
	if ("getForId" in query) {
		const output = await driver.getForId({
			c,
			workerId: query.getForId.workerId,
		});
		if (!output) throw new errors.WorkerNotFound(query.getForId.workerId);
		workerOutput = output;
	} else if ("getForKey" in query) {
		const existingWorker = await driver.getWithKey({
			c,
			name: query.getForKey.name,
			key: query.getForKey.key,
		});
		if (!existingWorker) {
			throw new errors.WorkerNotFound(
				`${query.getForKey.name}:${JSON.stringify(query.getForKey.key)}`,
			);
		}
		workerOutput = existingWorker;
	} else if ("getOrCreateForKey" in query) {
		const getOrCreateOutput = await driver.getOrCreateWithKey({
			c,
			name: query.getOrCreateForKey.name,
			key: query.getOrCreateForKey.key,
			input: query.getOrCreateForKey.input,
			region: query.getOrCreateForKey.region,
		});
		workerOutput = {
			workerId: getOrCreateOutput.workerId,
		};
	} else if ("create" in query) {
		const createOutput = await driver.createWorker({
			c,
			name: query.create.name,
			key: query.create.key,
			input: query.create.input,
			region: query.create.region,
		});
		workerOutput = {
			workerId: createOutput.workerId,
		};
	} else {
		throw new errors.InvalidRequest("Invalid query format");
	}

	logger().debug("worker query result", {
		workerId: workerOutput.workerId,
	});
	return { workerId: workerOutput.workerId };
}

/**
 * Handle SSE connection request
 */
async function handleSseConnectRequest(
	c: HonoContext,
	registryConfig: RegistryConfig,
	driverConfig: DriverConfig,
	driver: ManagerDriver,
	handler: ManagerRouterHandler,
): Promise<Response> {
	let encoding: Encoding | undefined;
	try {
		encoding = getRequestEncoding(c.req);
		logger().debug("sse connection request received", { encoding });

		const params = ConnectRequestSchema.safeParse({
			query: getRequestQuery(c),
			encoding: c.req.header(HEADER_ENCODING),
			connParams: c.req.header(HEADER_CONN_PARAMS),
		});

		if (!params.success) {
			logger().error("invalid connection parameters", {
				error: params.error,
			});
			throw new errors.InvalidRequest(params.error);
		}

		const query = params.data.query;

		// Parse connection parameters for authentication
		const connParams = params.data.connParams
			? JSON.parse(params.data.connParams)
			: undefined;

		// Authenticate the request
		const authData = await authenticateEndpoint(
			c,
			driver,
			registryConfig,
			query,
			["connect"],
			connParams,
		);

		// Get the worker ID
		const { workerId } = await queryWorker(c, query, driver);
		invariant(workerId, "Missing worker ID");
		logger().debug("sse connection to worker", { workerId });

		// Handle based on mode
		if ("inline" in handler.routingHandler) {
			logger().debug("using inline proxy mode for sse connection");
			// Use the shared SSE handler
			return await handleSseConnect(
				c,
				registryConfig,
				driverConfig,
				handler.routingHandler.inline.handlers.onConnectSse,
				workerId,
				authData,
			);
		} else if ("custom" in handler.routingHandler) {
			logger().debug("using custom proxy mode for sse connection");
			const url = new URL("http://worker/connect/sse");

			// Always build fresh request to prevent forwarding unwanted headers
			const proxyRequest = new Request(url);
			proxyRequest.headers.set(HEADER_ENCODING, params.data.encoding);
			if (params.data.connParams) {
				proxyRequest.headers.set(HEADER_CONN_PARAMS, params.data.connParams);
			}
			if (authData) {
				proxyRequest.headers.set(HEADER_AUTH_DATA, JSON.stringify(authData));
			}
			return await handler.routingHandler.custom.proxyRequest(
				c,
				proxyRequest,
				workerId,
			);
		} else {
			assertUnreachable(handler.routingHandler);
		}
	} catch (error) {
		// If we receive an error during setup, we send the error and close the socket immediately
		//
		// We have to return the error over SSE since SSE clients cannot read vanilla HTTP responses

		const { code, message, metadata } = deconstructError(error, logger(), {
			sseEvent: "setup",
		});

		return streamSSE(c, async (stream) => {
			try {
				if (encoding) {
					// Serialize and send the connection error
					const errorMsg: ToClient = {
						b: {
							e: {
								c: code,
								m: message,
								md: metadata,
							},
						},
					};

					// Send the error message to the client
					const serialized = serialize(errorMsg, encoding);
					await stream.writeSSE({
						data:
							typeof serialized === "string"
								? serialized
								: Buffer.from(serialized).toString("base64"),
					});
				} else {
					// We don't know the encoding, send an error and close
					await stream.writeSSE({
						data: code,
						event: "error",
					});
				}
			} catch (serializeError) {
				logger().error("failed to send error to sse client", {
					error: serializeError,
				});
				await stream.writeSSE({
					data: "internal error during error handling",
					event: "error",
				});
			}

			// Stream will exit completely once function exits
		});
	}
}

/**
 * Handle WebSocket connection request
 */
async function handleWebSocketConnectRequest(
	c: HonoContext,
	upgradeWebSocket:
		| ((
				createEvents: (c: HonoContext) => any,
		  ) => (c: HonoContext, next: Next) => Promise<Response>)
		| undefined,
	registryConfig: RegistryConfig,
	driverConfig: DriverConfig,
	driver: ManagerDriver,
	handler: ManagerRouterHandler,
): Promise<Response> {
	invariant(upgradeWebSocket, "WebSockets not supported");

	let encoding: Encoding | undefined;
	try {
		logger().debug("websocket connection request received");

		// Parse configuration from Sec-WebSocket-Protocol header
		//
		// We use this instead of query parameters since this is more secure than
		// query parameters. Query parameters often get logged.
		//
		// Browsers don't support using headers, so this is the only way to
		// pass data securely.
		const protocols = c.req.header("sec-websocket-protocol");
		let queryRaw: string | undefined;
		let encodingRaw: string | undefined;
		let connParamsRaw: string | undefined;

		if (protocols) {
			// Parse protocols for conn_params.{token} pattern
			const protocolList = protocols.split(",").map((p) => p.trim());
			for (const protocol of protocolList) {
				if (protocol.startsWith("query.")) {
					queryRaw = decodeURIComponent(protocol.substring("query.".length));
				} else if (protocol.startsWith("encoding.")) {
					encodingRaw = protocol.substring("encoding.".length);
				} else if (protocol.startsWith("conn_params.")) {
					connParamsRaw = decodeURIComponent(
						protocol.substring("conn_params.".length),
					);
				}
			}
		}

		// Parse query
		let queryUnvalidated: unknown;
		try {
			queryUnvalidated = JSON.parse(queryRaw!);
		} catch (error) {
			logger().error("invalid query json", { error });
			throw new errors.InvalidQueryJSON(error);
		}

		// Parse conn params
		let connParamsUnvalidated: unknown = null;
		try {
			if (connParamsRaw) {
				connParamsUnvalidated = JSON.parse(connParamsRaw!);
			}
		} catch (error) {
			logger().error("invalid conn params", { error });
			throw new errors.InvalidParams(
				`Invalid params JSON: ${stringifyError(error)}`,
			);
		}

		// We can't use the standard headers with WebSockets
		//
		// All other information will be sent over the socket itself, since that data needs to be E2EE
		const params = ConnectWebSocketRequestSchema.safeParse({
			query: queryUnvalidated,
			encoding: encodingRaw,
			connParams: connParamsUnvalidated,
		});
		if (!params.success) {
			logger().error("invalid connection parameters", {
				error: params.error,
			});
			throw new errors.InvalidRequest(params.error);
		}
		encoding = params.data.encoding;

		// Authenticate endpoint
		const authData = await authenticateEndpoint(
			c,
			driver,
			registryConfig,
			params.data.query,
			["connect"],
			connParamsRaw,
		);

		// Get the worker ID
		const { workerId } = await queryWorker(c, params.data.query, driver);
		logger().debug("found worker for websocket connection", {
			workerId,
		});
		invariant(workerId, "missing worker id");

		if ("inline" in handler.routingHandler) {
			logger().debug("using inline proxy mode for websocket connection");
			invariant(
				handler.routingHandler.inline.handlers.onConnectWebSocket,
				"onConnectWebSocket not provided",
			);

			const onConnectWebSocket =
				handler.routingHandler.inline.handlers.onConnectWebSocket;
			return upgradeWebSocket((c) => {
				return handleWebSocketConnect(
					c,
					registryConfig,
					onConnectWebSocket,
					workerId,
					params.data.encoding,
					params.data.connParams,
					authData,
				);
			})(c, noopNext());
		} else if ("custom" in handler.routingHandler) {
			logger().debug("using custom proxy mode for websocket connection");

			// Proxy the WebSocket connection to the worker
			//
			// The proxyWebSocket handler will:
			// 1. Validate the WebSocket upgrade request
			// 2. Forward the request to the worker with the appropriate path
			// 3. Handle the WebSocket pair and proxy messages between client and worker
			return await handler.routingHandler.custom.proxyWebSocket(
				c,
				"/connect/websocket",
				workerId,
				params.data.encoding,
				params.data.connParams,
				authData,
				upgradeWebSocket,
			);
		} else {
			assertUnreachable(handler.routingHandler);
		}
	} catch (error) {
		// If we receive an error during setup, we send the error and close the socket immediately
		//
		// We have to return the error over WS since WebSocket clients cannot read vanilla HTTP responses

		const { code, message, metadata } = deconstructError(error, logger(), {
			wsEvent: "setup",
		});

		return await upgradeWebSocket(() => ({
			onOpen: async (_evt: unknown, ws: WSContext) => {
				if (encoding) {
					try {
						// Serialize and send the connection error
						const errorMsg: ToClient = {
							b: {
								e: {
									c: code,
									m: message,
									md: metadata,
								},
							},
						};

						// Send the error message to the client
						const serialized = serialize(errorMsg, encoding);
						ws.send(serialized);

						// Close the connection with an error code
						ws.close(1011, code);
					} catch (serializeError) {
						logger().error("failed to send error to websocket client", {
							error: serializeError,
						});
						ws.close(1011, "internal error during error handling");
					}
				} else {
					// We don't know the encoding so we send what we can
					ws.close(1011, code);
				}
			},
		}))(c, noopNext());
	}
}

/**
 * Handle a connection message request to a worker
 *
 * There is no authentication handler on this request since the connection
 * token is used to authenticate the message.
 */
async function handleMessageRequest(
	c: HonoContext,
	registryConfig: RegistryConfig,
	handler: ManagerRouterHandler,
): Promise<Response> {
	logger().debug("connection message request received");
	try {
		const params = ConnMessageRequestSchema.safeParse({
			workerId: c.req.header(HEADER_WORKER_ID),
			connId: c.req.header(HEADER_CONN_ID),
			encoding: c.req.header(HEADER_ENCODING),
			connToken: c.req.header(HEADER_CONN_TOKEN),
		});
		if (!params.success) {
			logger().error("invalid connection parameters", {
				error: params.error,
			});
			throw new errors.InvalidRequest(params.error);
		}
		const { workerId, connId, encoding, connToken } = params.data;

		// TODO: This endpoint can be used to exhause resources (DoS attack) on an worker if you know the worker ID:
		// 1. Get the worker ID (usually this is reasonably secure, but we don't assume worker ID is sensitive)
		// 2. Spam messages to the worker (the conn token can be invalid)
		// 3. The worker will be exhausted processing messages — even if the token is invalid
		//
		// The solution is we need to move the authorization of the connection token to this request handler
		// AND include the worker ID in the connection token so we can verify that it has permission to send
		// a message to that worker. This would require changing the token to a JWT so we can include a secure
		// payload, but this requires managing a private key & managing key rotations.
		//
		// All other solutions (e.g. include the worker name as a header or include the worker name in the worker ID)
		// have exploits that allow the caller to send messages to arbitrary workers.
		//
		// Currently, we assume this is not a critical problem because requests will likely get rate
		// limited before enough messages are passed to the worker to exhaust resources.

		// Handle based on mode
		if ("inline" in handler.routingHandler) {
			logger().debug("using inline proxy mode for connection message");
			// Use shared connection message handler with direct parameters
			return handleConnectionMessage(
				c,
				registryConfig,
				handler.routingHandler.inline.handlers.onConnMessage,
				connId,
				connToken as string,
				workerId,
			);
		} else if ("custom" in handler.routingHandler) {
			logger().debug("using custom proxy mode for connection message");
			const url = new URL("http://worker/connections/message");

			// Always build fresh request to prevent forwarding unwanted headers
			const proxyRequest = new Request(url, {
				method: "POST",
				body: c.req.raw.body,
			});
			proxyRequest.headers.set(HEADER_ENCODING, encoding);
			proxyRequest.headers.set(HEADER_CONN_ID, connId);
			proxyRequest.headers.set(HEADER_CONN_TOKEN, connToken);

			return await handler.routingHandler.custom.proxyRequest(
				c,
				proxyRequest,
				workerId,
			);
		} else {
			assertUnreachable(handler.routingHandler);
		}
	} catch (error) {
		logger().error("error proxying connection message", { error });

		// Use ProxyError if it's not already an WorkerError
		if (!errors.WorkerError.isWorkerError(error)) {
			throw new errors.ProxyError("connection message", error);
		} else {
			throw error;
		}
	}
}

/**
 * Handle an action request to a worker
 */
async function handleActionRequest(
	c: HonoContext,
	registryConfig: RegistryConfig,
	driverConfig: DriverConfig,
	driver: ManagerDriver,
	handler: ManagerRouterHandler,
): Promise<Response> {
	try {
		const actionName = c.req.param("action");
		logger().debug("action call received", { actionName });

		const params = ConnectRequestSchema.safeParse({
			query: getRequestQuery(c),
			encoding: c.req.header(HEADER_ENCODING),
			connParams: c.req.header(HEADER_CONN_PARAMS),
		});

		if (!params.success) {
			logger().error("invalid connection parameters", {
				error: params.error,
			});
			throw new errors.InvalidRequest(params.error);
		}

		// Parse connection parameters for authentication
		const connParams = params.data.connParams
			? JSON.parse(params.data.connParams)
			: undefined;

		// Authenticate the request
		const authData = await authenticateEndpoint(
			c,
			driver,
			registryConfig,
			params.data.query,
			["action"],
			connParams,
		);

		// Get the worker ID
		const { workerId } = await queryWorker(c, params.data.query, driver);
		logger().debug("found worker for action", { workerId });
		invariant(workerId, "Missing worker ID");

		// Handle based on mode
		if ("inline" in handler.routingHandler) {
			logger().debug("using inline proxy mode for action call");
			// Use shared action handler with direct parameter
			return handleAction(
				c,
				registryConfig,
				driverConfig,
				handler.routingHandler.inline.handlers.onAction,
				actionName,
				workerId,
				authData,
			);
		} else if ("custom" in handler.routingHandler) {
			logger().debug("using custom proxy mode for action call");

			const url = new URL(
				`http://worker/action/${encodeURIComponent(actionName)}`,
			);

			// Always build fresh request to prevent forwarding unwanted headers
			const proxyRequest = new Request(url, {
				method: "POST",
				body: c.req.raw.body,
			});
			proxyRequest.headers.set(HEADER_ENCODING, params.data.encoding);
			if (params.data.connParams) {
				proxyRequest.headers.set(HEADER_CONN_PARAMS, params.data.connParams);
			}
			if (authData) {
				proxyRequest.headers.set(HEADER_AUTH_DATA, JSON.stringify(authData));
			}

			return await handler.routingHandler.custom.proxyRequest(
				c,
				proxyRequest,
				workerId,
			);
		} else {
			assertUnreachable(handler.routingHandler);
		}
	} catch (error) {
		logger().error("error in action handler", { error });

		// Use ProxyError if it's not already an WorkerError
		if (!errors.WorkerError.isWorkerError(error)) {
			throw new errors.ProxyError("Action call", error);
		} else {
			throw error;
		}
	}
}

/**
 * Handle the resolve request to get a worker ID from a query
 */
async function handleResolveRequest(
	c: HonoContext,
	registryConfig: RegistryConfig,
	driver: ManagerDriver,
): Promise<Response> {
	const encoding = getRequestEncoding(c.req);
	logger().debug("resolve request encoding", { encoding });

	const params = ResolveRequestSchema.safeParse({
		query: getRequestQuery(c),
		connParams: c.req.header(HEADER_CONN_PARAMS),
	});
	if (!params.success) {
		logger().error("invalid connection parameters", {
			error: params.error,
		});
		throw new errors.InvalidRequest(params.error);
	}

	// Parse connection parameters for authentication
	const connParams = params.data.connParams
		? JSON.parse(params.data.connParams)
		: undefined;

	const query = params.data.query;

	// Authenticate the request
	await authenticateEndpoint(c, driver, registryConfig, query, [], connParams);

	// Get the worker ID
	const { workerId } = await queryWorker(c, query, driver);
	logger().debug("resolved worker", { workerId });
	invariant(workerId, "Missing worker ID");

	// Format response according to protocol
	const response: protoHttpResolve.ResolveResponse = {
		i: workerId,
	};
	const serialized = serialize(response, encoding);
	return c.body(serialized);
}

/** Generates a `Next` handler to pass to middleware in order to be able to call arbitrary middleware. */
function noopNext(): Next {
	return async () => {};
}
