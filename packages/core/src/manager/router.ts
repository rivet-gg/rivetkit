import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import * as cbor from "cbor-x";
import { Hono, type Context as HonoContext } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import type { WSContext } from "hono/ws";
import invariant from "invariant";
import type { CloseEvent, MessageEvent, WebSocket } from "ws";
import { z } from "zod";
import type { ConnRoutingHandler } from "@/actor/conn-routing-handler";
import * as errors from "@/actor/errors";
import type * as protoHttpResolve from "@/actor/protocol/http/resolve";
import type { Transport } from "@/actor/protocol/message/mod";
import type { ToClient } from "@/actor/protocol/message/to-client";
import { type Encoding, serialize } from "@/actor/protocol/serde";
import {
	ALLOWED_PUBLIC_HEADERS,
	getRequestEncoding,
	getRequestQuery,
	HEADER_ACTOR_ID,
	HEADER_ACTOR_QUERY,
	HEADER_AUTH_DATA,
	HEADER_CONN_ID,
	HEADER_CONN_PARAMS,
	HEADER_CONN_TOKEN,
	HEADER_ENCODING,
	handleAction,
	handleConnectionMessage,
	handleSseConnect,
	handleWebSocketConnect,
} from "@/actor/router-endpoints";
import { assertUnreachable } from "@/actor/utils";
import type { ClientDriver } from "@/client/client";
import {
	handleRouteError,
	handleRouteNotFound,
	loggerMiddleware,
} from "@/common/router";
import {
	type DeconstructedError,
	deconstructError,
	noopNext,
	stringifyError,
} from "@/common/utils";
import type { UniversalWebSocket } from "@/common/websocket-interface";
import type { RegistryConfig } from "@/registry/config";
import type { RunConfig } from "@/registry/run-config";
import { VERSION } from "@/utils";
import { authenticateEndpoint } from "./auth";
import type { ManagerDriver } from "./driver";
import { HonoWebSocketAdapter } from "./hono-websocket-adapter";
import { logger } from "./log";
import type { ActorQuery } from "./protocol/query";
import {
	ConnectRequestSchema,
	ConnectWebSocketRequestSchema,
	ConnMessageRequestSchema,
	ResolveRequestSchema,
} from "./protocol/query";

/**
 * Parse WebSocket protocol headers for query and connection parameters
 */
function parseWebSocketProtocols(protocols: string | undefined): {
	queryRaw: string | undefined;
	encodingRaw: string | undefined;
	connParamsRaw: string | undefined;
} {
	let queryRaw: string | undefined;
	let encodingRaw: string | undefined;
	let connParamsRaw: string | undefined;

	if (protocols) {
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

	return { queryRaw, encodingRaw, connParamsRaw };
}

type ManagerRouterHandler = {
	// onConnectInspector?: ManagerInspectorConnHandler;
	routingHandler: ConnRoutingHandler;
};

const OPENAPI_ENCODING = z.string().openapi({
	description: "The encoding format to use for the response (json, cbor)",
	example: "json",
});

const OPENAPI_ACTOR_QUERY = z.string().openapi({
	description: "Actor query information",
});

const OPENAPI_CONN_PARAMS = z.string().openapi({
	description: "Connection parameters",
});

const OPENAPI_ACTOR_ID = z.string().openapi({
	description: "Actor ID (used in some endpoints)",
	example: "actor-123456",
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
	runConfig: RunConfig,
	inlineClientDriver: ClientDriver,
	handler: ManagerRouterHandler,
): { router: Hono; openapi: OpenAPIHono } {
	const driver = runConfig.driver.manager;
	const router = new OpenAPIHono({ strict: false });

	router.use("*", loggerMiddleware(logger()));

	if (runConfig.cors) {
		const corsConfig = runConfig.cors;

		router.use("*", async (c, next) => {
			// Don't apply to WebSocket routes
			// HACK: This could be insecure if we had a varargs path. We have to check the path suffix for WS since we don't know the path that this router was mounted.
			// HACK: Checking "/websocket/" is not safe, but there is no other way to handle this if we don't know the base path this is
			// mounted on
			const path = c.req.path;
			if (
				path.endsWith("/actors/connect/websocket") ||
				path.includes("/websocket/") ||
				path.endsWith("/inspect")
			) {
				return next();
			}

			return cors({
				...corsConfig,
				allowHeaders: [
					...(corsConfig?.allowHeaders ?? []),
					...ALLOWED_PUBLIC_HEADERS,
					"Content-Type",
					"User-Agent",
				],
			})(c, next);
		});
	}

	// GET /
	router.get("/", (c: HonoContext) => {
		return c.text(
			"This is an RivetKit registry.\n\nLearn more at https://rivetkit.org",
		);
	});

	// POST /actors/resolve
	{
		const ResolveQuerySchema = z
			.object({
				query: z.any().openapi({
					example: { getForId: { actorId: "actor-123" } },
				}),
			})
			.openapi("ResolveQuery");

		const ResolveResponseSchema = z
			.object({
				i: z.string().openapi({
					example: "actor-123",
				}),
			})
			.openapi("ResolveResponse");

		const resolveRoute = createRoute({
			method: "post",
			path: "/actors/resolve",
			request: {
				body: {
					content: {
						"application/json": {
							schema: ResolveQuerySchema,
						},
					},
				},
				headers: z.object({
					[HEADER_ACTOR_QUERY]: OPENAPI_ACTOR_QUERY,
				}),
			},
			responses: buildOpenApiResponses(ResolveResponseSchema),
		});

		router.openapi(resolveRoute, (c) =>
			handleResolveRequest(c, registryConfig, driver),
		);
	}

	// GET /actors/connect/websocket
	{
		// HACK: WebSockets don't work with mounts, so we need to dynamically match the trailing path
		router.use("*", (c, next) => {
			if (c.req.path.endsWith("/actors/connect/websocket")) {
				return handleWebSocketConnectRequest(
					c,
					registryConfig,
					runConfig,
					driver,
					handler,
				);
			}

			return next();
		});

		// This route is a noop, just used to generate docs
		const wsRoute = createRoute({
			method: "get",
			path: "/actors/connect/websocket",
			responses: {
				101: {
					description: "WebSocket upgrade",
				},
			},
		});

		router.openapi(wsRoute, () => {
			throw new Error("Should be unreachable");
		});
	}

	// GET /actors/connect/sse
	{
		const sseRoute = createRoute({
			method: "get",
			path: "/actors/connect/sse",
			request: {
				headers: z.object({
					[HEADER_ENCODING]: OPENAPI_ENCODING,
					[HEADER_ACTOR_QUERY]: OPENAPI_ACTOR_QUERY,
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
			handleSseConnectRequest(c, registryConfig, runConfig, driver, handler),
		);
	}

	// POST /actors/action/:action
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
					example: { getForId: { actorId: "actor-123" } },
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
			path: "/actors/actions/{action}",
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
			handleActionRequest(c, registryConfig, runConfig, driver, handler),
		);
	}

	// POST /actors/message
	{
		const ConnectionMessageRequestSchema = z
			.object({
				message: z.any().openapi({
					example: { type: "message", content: "Hello, actor!" },
				}),
			})
			.openapi("ConnectionMessageRequest");

		const ConnectionMessageResponseSchema = z
			.any()
			.openapi("ConnectionMessageResponse");

		const messageRoute = createRoute({
			method: "post",
			path: "/actors/message",
			request: {
				body: {
					content: {
						"application/json": {
							schema: ConnectionMessageRequestSchema,
						},
					},
				},
				headers: z.object({
					[HEADER_ACTOR_ID]: OPENAPI_ACTOR_ID,
					[HEADER_CONN_ID]: OPENAPI_CONN_ID,
					[HEADER_ENCODING]: OPENAPI_ENCODING,
					[HEADER_CONN_TOKEN]: OPENAPI_CONN_TOKEN,
				}),
			},
			responses: buildOpenApiResponses(ConnectionMessageResponseSchema),
		});

		router.openapi(messageRoute, (c) =>
			handleMessageRequest(c, registryConfig, runConfig, handler),
		);
	}

	// Raw HTTP endpoints - /actors/:name/http/*
	{
		const RawHttpRequestBodySchema = z.any().optional().openapi({
			description: "Raw request body (can be any content type)",
		});

		const RawHttpResponseSchema = z.any().openapi({
			description: "Raw response from actor's onFetch handler",
		});

		// Define common route config
		const rawHttpRouteConfig = {
			path: "/actors/:name/http/*",
			request: {
				params: z.object({
					name: z.string().openapi({
						description: "Actor name",
						example: "my-actor",
					}),
				}),
				headers: z.object({
					[HEADER_ACTOR_QUERY]: OPENAPI_ACTOR_QUERY.optional(),
					[HEADER_CONN_PARAMS]: OPENAPI_CONN_PARAMS.optional(),
				}),
				body: {
					content: {
						"*/*": {
							schema: RawHttpRequestBodySchema,
						},
					},
				},
			},
			responses: {
				200: {
					description: "Success - response from actor's onFetch handler",
					content: {
						"*/*": {
							schema: RawHttpResponseSchema,
						},
					},
				},
				404: {
					description: "Actor does not have an onFetch handler",
				},
				500: {
					description: "Internal server error or invalid response from actor",
				},
			},
		};

		// Create routes for each HTTP method
		const httpMethods = [
			"get",
			"post",
			"put",
			"delete",
			"patch",
			"head",
			"options",
		] as const;
		for (const method of httpMethods) {
			const route = createRoute({
				method,
				...rawHttpRouteConfig,
			});

			router.openapi(route, async (c) => {
				return handleRawHttpRequest(
					c,
					registryConfig,
					runConfig,
					driver,
					handler,
				);
			});
		}
	}

	// Raw WebSocket endpoint - /actors/:name/websocket/*
	{
		const rawWebSocketRoute = createRoute({
			method: "get",
			path: "/actors/:name/websocket/*",
			request: {
				params: z.object({
					name: z.string().openapi({
						description: "Actor name",
						example: "my-actor",
					}),
				}),
				headers: z.object({
					"sec-websocket-protocol": z.string().optional().openapi({
						description:
							"WebSocket protocols containing query and connection parameters encoded as query.{encoded} and conn_params.{encoded}",
						example:
							"query.%7B%22getOrCreateForKey%22%3A%7B%22name%22%3A%22my-actor%22%2C%22key%22%3A%5B%22default%22%5D%7D%7D",
					}),
				}),
			},
			responses: {
				101: {
					description: "WebSocket upgrade successful",
				},
				400: {
					description: "WebSockets not enabled or invalid request",
				},
				404: {
					description: "Actor does not have an onWebSocket handler",
				},
			},
		});

		router.openapi(rawWebSocketRoute, async (c) => {
			const upgradeWebSocket = runConfig.getUpgradeWebSocket?.();
			if (!upgradeWebSocket) {
				return c.text(
					"WebSockets are not enabled for this driver. Use SSE instead.",
					400,
				);
			}

			return handleRawWebSocketRequest(
				c,
				registryConfig,
				runConfig,
				driver,
				handler,
				upgradeWebSocket,
			);
		});
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

		router.get(".test/inline-driver/connect-websocket", async (c) => {
			const upgradeWebSocket = runConfig.getUpgradeWebSocket?.();
			invariant(upgradeWebSocket, "websockets not supported on this platform");

			return upgradeWebSocket(async (c: any) => {
				const {
					actorQuery: actorQueryRaw,
					params: paramsRaw,
					encodingKind,
				} = c.req.query() as {
					actorQuery: string;
					params?: string;
					encodingKind: Encoding;
				};
				const actorQuery = JSON.parse(actorQueryRaw);
				const params =
					paramsRaw !== undefined ? JSON.parse(paramsRaw) : undefined;

				logger().debug("received test inline driver websocket", {
					actorQuery,
					params,
					encodingKind,
				});

				// Connect to the actor using the inline client driver - this returns a Promise<WebSocket>
				const clientWsPromise = inlineClientDriver.connectWebSocket(
					undefined,
					actorQuery,
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
							clientWs.addEventListener(
								"message",
								(clientEvt: MessageEvent) => {
									logger().debug("test websocket connection message");

									if (serverWs.readyState === 1) {
										// OPEN
										serverWs.send(clientEvt.data as any);
									}
								},
							);

							// Add close handler to close server when client closes
							clientWs.addEventListener("close", (clientEvt: CloseEvent) => {
								logger().debug("test websocket connection closed");

								if (serverWs.readyState !== 3) {
									// Not CLOSED
									serverWs.close(clientEvt.code, clientEvt.reason);
								}
							});

							// Add error handler
							clientWs.addEventListener("error", () => {
								logger().debug("test websocket connection error");

								if (serverWs.readyState !== 3) {
									// Not CLOSED
									serverWs.close(1011, "Error in client websocket");
								}
							});
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
			})(c, noopNext());
		});
	}

	router.doc("/openapi.json", {
		openapi: "3.0.0",
		info: {
			version: VERSION,
			title: "RivetKit API",
		},
	});

	driver.modifyManagerRouter?.(registryConfig, router as unknown as Hono);

	router.notFound(handleRouteNotFound);
	router.onError(handleRouteError.bind(undefined, {}));

	// Mount on both / and /registry
	//
	// We do this because the default requests are to `/registry/*`.
	//
	// If using `app.fetch` directly in a non-hono router, paths
	// might not be truncated so they'll come to this router as
	// `/registry/*`. If mounted correctly in Hono, requests will
	// come in at the root as `/*`.
	const mountedRouter = new Hono();
	mountedRouter.route("/", router);
	mountedRouter.route("/registry", router);

	return { router: mountedRouter, openapi: router };
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
 * Query the manager driver to get or create a actor based on the provided query
 */
export async function queryActor(
	c: HonoContext,
	query: ActorQuery,
	driver: ManagerDriver,
): Promise<{ actorId: string }> {
	logger().debug("querying actor", { query });
	let actorOutput: { actorId: string };
	if ("getForId" in query) {
		const output = await driver.getForId({
			c,
			actorId: query.getForId.actorId,
		});
		if (!output) throw new errors.ActorNotFound(query.getForId.actorId);
		actorOutput = output;
	} else if ("getForKey" in query) {
		const existingActor = await driver.getWithKey({
			c,
			name: query.getForKey.name,
			key: query.getForKey.key,
		});
		if (!existingActor) {
			throw new errors.ActorNotFound(
				`${query.getForKey.name}:${JSON.stringify(query.getForKey.key)}`,
			);
		}
		actorOutput = existingActor;
	} else if ("getOrCreateForKey" in query) {
		const getOrCreateOutput = await driver.getOrCreateWithKey({
			c,
			name: query.getOrCreateForKey.name,
			key: query.getOrCreateForKey.key,
			input: query.getOrCreateForKey.input,
			region: query.getOrCreateForKey.region,
		});
		actorOutput = {
			actorId: getOrCreateOutput.actorId,
		};
	} else if ("create" in query) {
		const createOutput = await driver.createActor({
			c,
			name: query.create.name,
			key: query.create.key,
			input: query.create.input,
			region: query.create.region,
		});
		actorOutput = {
			actorId: createOutput.actorId,
		};
	} else {
		throw new errors.InvalidRequest("Invalid query format");
	}

	logger().debug("actor query result", {
		actorId: actorOutput.actorId,
	});
	return { actorId: actorOutput.actorId };
}

/**
 * Handle SSE connection request
 */
async function handleSseConnectRequest(
	c: HonoContext,
	registryConfig: RegistryConfig,
	runConfig: RunConfig,
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

		// Get the actor ID
		const { actorId } = await queryActor(c, query, driver);
		invariant(actorId, "Missing actor ID");
		logger().debug("sse connection to actor", { actorId });

		// Handle based on mode
		if ("inline" in handler.routingHandler) {
			logger().debug("using inline proxy mode for sse connection");
			// Use the shared SSE handler
			return await handleSseConnect(
				c,
				registryConfig,
				runConfig,
				handler.routingHandler.inline.handlers.onConnectSse,
				actorId,
				authData,
			);
		} else if ("custom" in handler.routingHandler) {
			logger().debug("using custom proxy mode for sse connection");
			const url = new URL("http://actor/connect/sse");

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
				actorId,
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
	registryConfig: RegistryConfig,
	runConfig: RunConfig,
	driver: ManagerDriver,
	handler: ManagerRouterHandler,
): Promise<Response> {
	const upgradeWebSocket = runConfig.getUpgradeWebSocket?.();
	if (!upgradeWebSocket) {
		return c.text(
			"WebSockets are not enabled for this driver. Use SSE instead.",
			400,
		);
	}

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
		const { queryRaw, encodingRaw, connParamsRaw } =
			parseWebSocketProtocols(protocols);

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

		// Get the actor ID
		const { actorId } = await queryActor(c, params.data.query, driver);
		logger().debug("found actor for websocket connection", {
			actorId,
		});
		invariant(actorId, "missing actor id");

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
					runConfig,
					onConnectWebSocket,
					actorId,
					params.data.encoding,
					params.data.connParams,
					authData,
				);
			})(c, noopNext());
		} else if ("custom" in handler.routingHandler) {
			logger().debug("using custom proxy mode for websocket connection");

			// Proxy the WebSocket connection to the actor
			//
			// The proxyWebSocket handler will:
			// 1. Validate the WebSocket upgrade request
			// 2. Forward the request to the actor with the appropriate path
			// 3. Handle the WebSocket pair and proxy messages between client and actor
			return await handler.routingHandler.custom.proxyWebSocket(
				c,
				"/connect/websocket",
				actorId,
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
 * Handle a connection message request to a actor
 *
 * There is no authentication handler on this request since the connection
 * token is used to authenticate the message.
 */
async function handleMessageRequest(
	c: HonoContext,
	registryConfig: RegistryConfig,
	runConfig: RunConfig,
	handler: ManagerRouterHandler,
): Promise<Response> {
	logger().debug("connection message request received");
	try {
		const params = ConnMessageRequestSchema.safeParse({
			actorId: c.req.header(HEADER_ACTOR_ID),
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
		const { actorId, connId, encoding, connToken } = params.data;

		// TODO: This endpoint can be used to exhause resources (DoS attack) on an actor if you know the actor ID:
		// 1. Get the actor ID (usually this is reasonably secure, but we don't assume actor ID is sensitive)
		// 2. Spam messages to the actor (the conn token can be invalid)
		// 3. The actor will be exhausted processing messages — even if the token is invalid
		//
		// The solution is we need to move the authorization of the connection token to this request handler
		// AND include the actor ID in the connection token so we can verify that it has permission to send
		// a message to that actor. This would require changing the token to a JWT so we can include a secure
		// payload, but this requires managing a private key & managing key rotations.
		//
		// All other solutions (e.g. include the actor name as a header or include the actor name in the actor ID)
		// have exploits that allow the caller to send messages to arbitrary actors.
		//
		// Currently, we assume this is not a critical problem because requests will likely get rate
		// limited before enough messages are passed to the actor to exhaust resources.

		// Handle based on mode
		if ("inline" in handler.routingHandler) {
			logger().debug("using inline proxy mode for connection message");
			// Use shared connection message handler with direct parameters
			return handleConnectionMessage(
				c,
				registryConfig,
				runConfig,
				handler.routingHandler.inline.handlers.onConnMessage,
				connId,
				connToken as string,
				actorId,
			);
		} else if ("custom" in handler.routingHandler) {
			logger().debug("using custom proxy mode for connection message");
			const url = new URL("http://actor/connections/message");

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
				actorId,
			);
		} else {
			assertUnreachable(handler.routingHandler);
		}
	} catch (error) {
		logger().error("error proxying connection message", { error });

		// Use ProxyError if it's not already an ActorError
		if (!errors.ActorError.isActorError(error)) {
			throw new errors.ProxyError("connection message", error);
		} else {
			throw error;
		}
	}
}

/**
 * Handle an action request to a actor
 */
async function handleActionRequest(
	c: HonoContext,
	registryConfig: RegistryConfig,
	runConfig: RunConfig,
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

		// Get the actor ID
		const { actorId } = await queryActor(c, params.data.query, driver);
		logger().debug("found actor for action", { actorId });
		invariant(actorId, "Missing actor ID");

		// Handle based on mode
		if ("inline" in handler.routingHandler) {
			logger().debug("using inline proxy mode for action call");
			// Use shared action handler with direct parameter
			return handleAction(
				c,
				registryConfig,
				runConfig,
				handler.routingHandler.inline.handlers.onAction,
				actionName,
				actorId,
				authData,
			);
		} else if ("custom" in handler.routingHandler) {
			logger().debug("using custom proxy mode for action call");

			const url = new URL(
				`http://actor/action/${encodeURIComponent(actionName)}`,
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
				actorId,
			);
		} else {
			assertUnreachable(handler.routingHandler);
		}
	} catch (error) {
		logger().error("error in action handler", { error: stringifyError(error) });

		// Use ProxyError if it's not already an ActorError
		if (!errors.ActorError.isActorError(error)) {
			throw new errors.ProxyError("Action call", error);
		} else {
			throw error;
		}
	}
}

/**
 * Handle the resolve request to get a actor ID from a query
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

	// Get the actor ID
	const { actorId } = await queryActor(c, query, driver);
	logger().debug("resolved actor", { actorId });
	invariant(actorId, "Missing actor ID");

	// Format response according to protocol
	const response: protoHttpResolve.ResolveResponse = {
		i: actorId,
	};
	const serialized = serialize(response, encoding);
	return c.body(serialized);
}

/**
 * Handle raw HTTP requests to an actor
 */
async function handleRawHttpRequest(
	c: HonoContext,
	registryConfig: RegistryConfig,
	runConfig: RunConfig,
	driver: ManagerDriver,
	handler: ManagerRouterHandler,
): Promise<Response> {
	try {
		const actorName = c.req.param("name");
		const subpath = c.req.path.split("/http/")[1] || "";
		logger().debug("raw http request received", { actorName, subpath });

		// Get actor query from header (consistent with other endpoints)
		const queryHeader = c.req.header(HEADER_ACTOR_QUERY);
		if (!queryHeader) {
			throw new errors.InvalidRequest("Missing actor query header");
		}
		const query: ActorQuery = JSON.parse(queryHeader);

		// Parse connection parameters for authentication
		const connParamsHeader = c.req.header(HEADER_CONN_PARAMS);
		const connParams = connParamsHeader
			? JSON.parse(connParamsHeader)
			: undefined;

		// Authenticate the request
		const authData = await authenticateEndpoint(
			c,
			driver,
			registryConfig,
			query,
			["action"],
			connParams,
		);

		// Get the actor ID
		const { actorId } = await queryActor(c, query, driver);
		logger().debug("found actor for raw http", { actorId });
		invariant(actorId, "Missing actor ID");

		// Handle based on mode
		if ("inline" in handler.routingHandler) {
			logger().debug("using inline mode for raw http");

			// Check if we have an onFetch handler
			const handlers = handler.routingHandler.inline.handlers;
			if (!handlers.onFetch) {
				throw new errors.FetchHandlerNotDefined();
			}

			// Create a new request with the correct URL path
			const url = new URL(c.req.url);
			url.pathname = `/${subpath}`;
			const request = new Request(url.toString(), c.req.raw);

			// Call the onFetch handler
			const response = await handlers.onFetch({
				request,
				actorId,
				authData,
			});

			return response;
		} else if ("custom" in handler.routingHandler) {
			logger().debug("using custom proxy mode for raw http");

			const url = new URL(`http://actor/http/${subpath}`);

			// Forward the request to the actor
			const proxyRequest = new Request(url, {
				method: c.req.method,
				headers: c.req.raw.headers,
				body: c.req.raw.body,
			});

			// Forward conn params if provided
			if (connParams) {
				proxyRequest.headers.set(
					HEADER_CONN_PARAMS,
					JSON.stringify(connParams),
				);
			}
			// Forward auth data to actor
			if (authData) {
				proxyRequest.headers.set(HEADER_AUTH_DATA, JSON.stringify(authData));
			}

			return await handler.routingHandler.custom.proxyRequest(
				c,
				proxyRequest,
				actorId,
			);
		} else {
			assertUnreachable(handler.routingHandler);
		}
	} catch (error) {
		logger().error("error in raw http handler", {
			error: stringifyError(error),
		});

		// Use ProxyError if it's not already an ActorError
		if (!errors.ActorError.isActorError(error)) {
			throw new errors.ProxyError("Raw HTTP request", error);
		} else {
			throw error;
		}
	}
}

/**
 * Handle raw WebSocket requests to an actor
 */
async function handleRawWebSocketRequest(
	c: HonoContext,
	registryConfig: RegistryConfig,
	runConfig: RunConfig,
	driver: ManagerDriver,
	handler: ManagerRouterHandler,
	upgradeWebSocket: any,
): Promise<Response> {
	try {
		const actorName = c.req.param("name");
		const subpath = c.req.path.split("/websocket/")[1] || "";
		logger().debug("raw websocket request received", { actorName, subpath });

		// Get actor query and connection parameters from WebSocket protocols only
		let query: ActorQuery;
		let connParams: unknown;

		// Parse protocols from Sec-WebSocket-Protocol header
		const protocols = c.req.header("sec-websocket-protocol");
		const {
			queryRaw: queryFromProtocol,
			connParamsRaw: connParamsFromProtocol,
		} = parseWebSocketProtocols(protocols);

		if (!queryFromProtocol) {
			throw new errors.InvalidRequest("Missing query in WebSocket protocol");
		}
		query = JSON.parse(queryFromProtocol);

		// Parse connection parameters from protocol
		if (connParamsFromProtocol) {
			connParams = JSON.parse(connParamsFromProtocol);
		}

		// Authenticate the request
		const authData = await authenticateEndpoint(
			c,
			driver,
			registryConfig,
			query,
			["action"],
			connParams,
		);

		// Get the actor ID
		const { actorId } = await queryActor(c, query, driver);
		logger().debug("found actor for raw websocket", { actorId });
		invariant(actorId, "Missing actor ID");

		// Handle based on mode
		if ("inline" in handler.routingHandler) {
			logger().debug("using inline mode for raw websocket");

			// Check if we have an onWebSocket handler
			const handlers = handler.routingHandler.inline.handlers;
			const onWebSocket = handlers.onWebSocket;
			if (!onWebSocket) {
				throw new errors.WebSocketHandlerNotDefined();
			}

			// Create a WebSocket upgrade handler
			return upgradeWebSocket(() => {
				// Create a new request with the correct URL path
				const url = new URL(c.req.url);
				url.pathname = `/${subpath}`;
				const request = new Request(url.toString(), {
					method: c.req.method,
					headers: c.req.raw.headers,
				});

				let bridge: HonoWebSocketAdapter | undefined;

				return {
					onOpen: async (_evt: any, ws: WSContext) => {
						logger().debug("raw websocket connection opened");

						// Create a HonoWebSocketAdapter to convert WSContext to WebSocket interface
						bridge = new HonoWebSocketAdapter(ws);

						// Call the onWebSocket handler
						try {
							await onWebSocket({
								request,
								websocket: bridge as any,
								actorId,
								authData,
							});
						} catch (error) {
							logger().error("error in onWebSocket handler", {
								error: stringifyError(error),
							});
							ws.close(1011, "Internal server error");
						}
					},
					onMessage: async (message: any, ws: WSContext) => {
						invariant(bridge, "Bridge not initialized");
						// Forward the message to the bridge
						// Hono passes the raw data, not a MessageEvent
						bridge._handleMessage(message);
					},
					onClose: async (evt: any, ws: WSContext) => {
						invariant(bridge, "Bridge not initialized");
						bridge._handleClose(evt.code || 1000, evt.reason || "");
					},
					onError: async (error: unknown) => {
						logger().error("error in raw websocket connection", { error });
						invariant(bridge, "Bridge not initialized");
						bridge._handleError(error);
					},
				};
			})(c, noopNext());
		} else if ("custom" in handler.routingHandler) {
			logger().debug("using custom proxy mode for raw websocket");

			const url = new URL(`http://actor/websocket/${subpath}`);

			// For custom mode, proxy the WebSocket
			return upgradeWebSocket(async (ws: WSContext) => {
				try {
					// Use the custom proxy handler
					const customHandler = handler.routingHandler as {
						custom: import("@/actor/conn-routing-handler").ConnRoutingHandlerCustom;
					};
					await customHandler.custom.proxyWebSocket(
						c,
						`/websocket/${subpath}`,
						actorId,
						"json", // Default encoding for raw WebSocket
						connParams, // Pass connection parameters
						authData,
						upgradeWebSocket,
					);
				} catch (error) {
					logger().error("error proxying raw websocket", {
						error: stringifyError(error),
					});
					ws.close(1011, "Proxy error");
				}
			});
		} else {
			assertUnreachable(handler.routingHandler);
		}
	} catch (error) {
		logger().error("error in raw websocket handler", {
			error: stringifyError(error),
		});

		// Return error response instead of WebSocket upgrade
		return c.text("WebSocket upgrade failed: " + stringifyError(error), 500);
	}
}
