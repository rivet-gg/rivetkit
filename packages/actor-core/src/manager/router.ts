import * as errors from "@/actor/errors";
import type * as protoHttpResolve from "@/actor/protocol/http/resolve";
import type { ToClient } from "@/actor/protocol/message/to-client";
import { type Encoding, serialize } from "@/actor/protocol/serde";
import {
	type ConnectionHandlers,
	getRequestEncoding,
	handleConnectionMessage,
	handleAction,
	handleSseConnect,
	handleWebSocketConnect,
	HEADER_ACTOR_ID,
	HEADER_CONN_ID,
	HEADER_CONN_PARAMS,
	HEADER_CONN_TOKEN,
	HEADER_ENCODING,
	HEADER_ACTOR_QUERY,
	ALL_HEADERS,
	getRequestQuery,
} from "@/actor/router-endpoints";
import { assertUnreachable } from "@/actor/utils";
import type { AppConfig } from "@/app/config";
import {
	handleRouteError,
	handleRouteNotFound,
	loggerMiddleware,
} from "@/common/router";
import { deconstructError } from "@/common/utils";
import type { DriverConfig } from "@/driver-helpers/config";
import {
	type ManagerInspectorConnHandler,
	createManagerInspectorRouter,
} from "@/inspector/manager";
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
import type { ActorQuery } from "./protocol/query";
import { VERSION } from "@/utils";

type ProxyMode =
	| {
			inline: {
				handlers: ConnectionHandlers;
			};
	  }
	| {
			custom: {
				onProxyRequest: OnProxyRequest;
				onProxyWebSocket: OnProxyWebSocket;
			};
	  };

export type BuildProxyEndpoint = (c: HonoContext, actorId: string) => string;

export type OnProxyRequest = (
	c: HonoContext,
	actorRequest: Request,
	actorId: string,
	meta?: unknown,
) => Promise<Response>;

export type OnProxyWebSocket = (
	c: HonoContext,
	path: string,
	actorId: string,
	meta?: unknown,
) => Promise<Response>;

type ManagerRouterHandler = {
	onConnectInspector?: ManagerInspectorConnHandler;
	proxyMode: ProxyMode;
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
	appConfig: AppConfig,
	driverConfig: DriverConfig,
	handler: ManagerRouterHandler,
) {
	if (!driverConfig.drivers?.manager) {
		// FIXME move to config schema
		throw new Error("config.drivers.manager is not defined.");
	}
	const driver = driverConfig.drivers.manager;
	const app = new OpenAPIHono();

	const upgradeWebSocket = driverConfig.getUpgradeWebSocket?.(
		app as unknown as Hono,
	);

	app.use("*", loggerMiddleware(logger()));

	if (appConfig.cors) {
		const corsConfig = appConfig.cors;

		app.use("*", async (c, next) => {
			const path = c.req.path;

			// Don't apply to WebSocket routes
			if (path === "/actors/connect/websocket" || path === "/inspect") {
				return next();
			}

			return cors({
				...corsConfig,
				allowHeaders: [...(appConfig.cors?.allowHeaders ?? []), ...ALL_HEADERS],
			})(c, next);
		});
	}

	// GET /
	app.get("/", (c) => {
		return c.text(
			"This is an ActorCore server.\n\nLearn more at https://actorcore.org",
		);
	});

	// GET /health
	app.get("/health", (c) => {
		return c.text("ok");
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

		app.openapi(resolveRoute, (c) => handleResolveRequest(c, driver));
	}

	// GET /actors/connect/websocket
	{
		const wsRoute = createRoute({
			method: "get",
			path: "/actors/connect/websocket",
			request: {
				query: z.object({
					encoding: OPENAPI_ENCODING,
					query: OPENAPI_ACTOR_QUERY,
				}),
			},
			responses: {
				101: {
					description: "WebSocket upgrade",
				},
			},
		});

		app.openapi(wsRoute, (c) =>
			handleWebSocketConnectRequest(
				c,
				upgradeWebSocket,
				appConfig,
				driverConfig,
				driver,
				handler,
			),
		);
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

		app.openapi(sseRoute, (c) =>
			handleSseConnectRequest(c, appConfig, driverConfig, driver, handler),
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

		app.openapi(actionRoute, (c) =>
			handleActionRequest(c, appConfig, driverConfig, driver, handler),
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

		app.openapi(messageRoute, (c) =>
			handleMessageRequest(c, appConfig, handler),
		);
	}

	if (appConfig.inspector.enabled) {
		app.route(
			"/inspect",
			createManagerInspectorRouter(
				upgradeWebSocket,
				handler.onConnectInspector,
				appConfig.inspector,
			),
		);
	}

	app.doc("/openapi.json", {
		openapi: "3.0.0",
		info: {
			version: VERSION,
			title: "ActorCore API",
		},
	});

	app.notFound(handleRouteNotFound);
	app.onError(handleRouteError);

	return app as unknown as Hono;
}

/**
 * Query the manager driver to get or create an actor based on the provided query
 */
export async function queryActor(
	c: HonoContext,
	query: ActorQuery,
	driver: ManagerDriver,
): Promise<{ actorId: string; meta?: unknown }> {
	logger().debug("querying actor", { query });
	let actorOutput: { actorId: string; meta?: unknown };
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
		const existingActor = await driver.getWithKey({
			c,
			name: query.getOrCreateForKey.name,
			key: query.getOrCreateForKey.key,
		});
		if (existingActor) {
			// Actor exists
			actorOutput = existingActor;
		} else {
			// Create if needed
			const createOutput = await driver.createActor({
				c,
				name: query.getOrCreateForKey.name,
				key: query.getOrCreateForKey.key,
				region: query.getOrCreateForKey.region,
			});
			actorOutput = {
				actorId: createOutput.actorId,
				meta: createOutput.meta,
			};
		}
	} else if ("create" in query) {
		const createOutput = await driver.createActor({
			c,
			name: query.create.name,
			key: query.create.key,
			region: query.create.region,
		});
		actorOutput = {
			actorId: createOutput.actorId,
			meta: createOutput.meta,
		};
	} else {
		throw new errors.InvalidRequest("Invalid query format");
	}

	logger().debug("actor query result", {
		actorId: actorOutput.actorId,
		meta: actorOutput.meta,
	});
	return { actorId: actorOutput.actorId, meta: actorOutput.meta };
}

/**
 * Handle SSE connection request
 */
async function handleSseConnectRequest(
	c: HonoContext,
	appConfig: AppConfig,
	driverConfig: DriverConfig,
	driver: ManagerDriver,
	handler: ManagerRouterHandler,
): Promise<Response> {
	let encoding: Encoding | undefined;
	try {
		encoding = getRequestEncoding(c.req, false);
		logger().debug("sse connection request received", { encoding });

		const params = ConnectRequestSchema.safeParse({
			query: getRequestQuery(c, false),
			encoding: c.req.header(HEADER_ENCODING),
			params: c.req.header(HEADER_CONN_PARAMS),
		});

		if (!params.success) {
			logger().error("invalid connection parameters", {
				error: params.error,
			});
			throw new errors.InvalidRequest(params.error);
		}

		const query = params.data.query;

		// Get the actor ID and meta
		const { actorId, meta } = await queryActor(c, query, driver);
		invariant(actorId, "Missing actor ID");
		logger().debug("sse connection to actor", { actorId, meta });

		// Handle based on mode
		if ("inline" in handler.proxyMode) {
			logger().debug("using inline proxy mode for sse connection");
			// Use the shared SSE handler
			return await handleSseConnect(
				c,
				appConfig,
				driverConfig,
				handler.proxyMode.inline.handlers.onConnectSse,
				actorId,
			);
		} else if ("custom" in handler.proxyMode) {
			logger().debug("using custom proxy mode for sse connection");
			const url = new URL("http://actor/connect/sse");
			const proxyRequest = new Request(url, c.req.raw);
			proxyRequest.headers.set(HEADER_ENCODING, params.data.encoding);
			if (params.data.connParams) {
				proxyRequest.headers.set(HEADER_CONN_PARAMS, params.data.connParams);
			}
			return await handler.proxyMode.custom.onProxyRequest(
				c,
				proxyRequest,
				actorId,
				meta,
			);
		} else {
			assertUnreachable(handler.proxyMode);
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
	appConfig: AppConfig,
	driverConfig: DriverConfig,
	driver: ManagerDriver,
	handler: ManagerRouterHandler,
): Promise<Response> {
	invariant(upgradeWebSocket, "WebSockets not supported");

	let encoding: Encoding | undefined;
	try {
		logger().debug("websocket connection request received");

		// We can't use the standard headers with WebSockets
		//
		// All other information will be sent over the socket itself, since that data needs to be E2EE
		const params = ConnectWebSocketRequestSchema.safeParse({
			query: getRequestQuery(c, true),
			encoding: c.req.query("encoding"),
		});
		if (!params.success) {
			logger().error("invalid connection parameters", {
				error: params.error,
			});
			throw new errors.InvalidRequest(params.error);
		}

		// Get the actor ID and meta
		const { actorId, meta } = await queryActor(c, params.data.query, driver);
		logger().debug("found actor for websocket connection", { actorId, meta });
		invariant(actorId, "missing actor id");

		if ("inline" in handler.proxyMode) {
			logger().debug("using inline proxy mode for websocket connection");
			invariant(
				handler.proxyMode.inline.handlers.onConnectWebSocket,
				"onConnectWebSocket not provided",
			);

			const onConnectWebSocket =
				handler.proxyMode.inline.handlers.onConnectWebSocket;
			return upgradeWebSocket((c) => {
				return handleWebSocketConnect(
					c,
					appConfig,
					driverConfig,
					onConnectWebSocket,
					actorId,
				)();
			})(c, noopNext());
		} else if ("custom" in handler.proxyMode) {
			logger().debug("using custom proxy mode for websocket connection");
			return await handler.proxyMode.custom.onProxyWebSocket(
				c,
				`/connect/websocket?encoding=${params.data.encoding}`,
				actorId,
				meta,
			);
		} else {
			assertUnreachable(handler.proxyMode);
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
 * Handle a connection message request to an actor
 */
async function handleMessageRequest(
	c: HonoContext,
	appConfig: AppConfig,
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

		// Handle based on mode
		if ("inline" in handler.proxyMode) {
			logger().debug("using inline proxy mode for connection message");
			// Use shared connection message handler with direct parameters
			return handleConnectionMessage(
				c,
				appConfig,
				handler.proxyMode.inline.handlers.onConnMessage,
				connId,
				connToken as string,
				actorId,
			);
		} else if ("custom" in handler.proxyMode) {
			logger().debug("using custom proxy mode for connection message");
			const url = new URL(`http://actor/connections/${connId}/message`);

			const proxyRequest = new Request(url, c.req.raw);
			proxyRequest.headers.set(HEADER_ENCODING, encoding);
			proxyRequest.headers.set(HEADER_CONN_ID, connId);
			proxyRequest.headers.set(HEADER_CONN_TOKEN, connToken);

			return await handler.proxyMode.custom.onProxyRequest(
				c,
				proxyRequest,
				actorId,
			);
		} else {
			assertUnreachable(handler.proxyMode);
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
 * Handle an action request to an actor
 */
async function handleActionRequest(
	c: HonoContext,
	appConfig: AppConfig,
	driverConfig: DriverConfig,
	driver: ManagerDriver,
	handler: ManagerRouterHandler,
): Promise<Response> {
	try {
		const actionName = c.req.param("action");
		logger().debug("action call received", { actionName });

		const params = ConnectRequestSchema.safeParse({
			query: getRequestQuery(c, false),
			encoding: c.req.header(HEADER_ENCODING),
			params: c.req.header(HEADER_CONN_PARAMS),
		});

		if (!params.success) {
			logger().error("invalid connection parameters", {
				error: params.error,
			});
			throw new errors.InvalidRequest(params.error);
		}

		// Get the actor ID and meta
		const { actorId, meta } = await queryActor(c, params.data.query, driver);
		logger().debug("found actor for action", { actorId, meta });
		invariant(actorId, "Missing actor ID");

		// Handle based on mode
		if ("inline" in handler.proxyMode) {
			logger().debug("using inline proxy mode for action call");
			// Use shared action handler with direct parameter
			return handleAction(
				c,
				appConfig,
				driverConfig,
				handler.proxyMode.inline.handlers.onAction,
				actionName,
				actorId,
			);
		} else if ("custom" in handler.proxyMode) {
			logger().debug("using custom proxy mode for action call");
			const url = new URL(
				`http://actor/action/${encodeURIComponent(actionName)}`,
			);
			const proxyRequest = new Request(url, c.req.raw);
			return await handler.proxyMode.custom.onProxyRequest(
				c,
				proxyRequest,
				actorId,
				meta,
			);
		} else {
			assertUnreachable(handler.proxyMode);
		}
	} catch (error) {
		logger().error("error in action handler", { error });

		// Use ProxyError if it's not already an ActorError
		if (!errors.ActorError.isActorError(error)) {
			throw new errors.ProxyError("Action call", error);
		} else {
			throw error;
		}
	}
}

/**
 * Handle the resolve request to get an actor ID from a query
 */
async function handleResolveRequest(
	c: HonoContext,
	driver: ManagerDriver,
): Promise<Response> {
	const encoding = getRequestEncoding(c.req, false);
	logger().debug("resolve request encoding", { encoding });

	const params = ResolveRequestSchema.safeParse({
		query: getRequestQuery(c, false),
	});
	if (!params.success) {
		logger().error("invalid connection parameters", {
			error: params.error,
		});
		throw new errors.InvalidRequest(params.error);
	}

	// Get the actor ID and meta
	const { actorId, meta } = await queryActor(c, params.data.query, driver);
	logger().debug("resolved actor", { actorId, meta });
	invariant(actorId, "Missing actor ID");

	// Format response according to protocol
	const response: protoHttpResolve.ResolveResponse = {
		i: actorId,
	};
	const serialized = serialize(response, encoding);
	return c.body(serialized);
}

/** Generates a `Next` handler to pass to middleware in order to be able to call arbitrary middleware. */
function noopNext(): Next {
	return async () => {};
}
