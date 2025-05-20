import * as errors from "@/actor/errors";
import type * as protoHttpResolve from "@/actor/protocol/http/resolve";
import type { ToClient } from "@/actor/protocol/message/to-client";
import { type Encoding, serialize } from "@/actor/protocol/serde";
import {
	type ConnectionHandlers,
	getRequestEncoding,
	handleConnectionMessage,
	handleRpc,
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
	const app = new Hono();

	const upgradeWebSocket = driverConfig.getUpgradeWebSocket?.(app);

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

	app.get("/", (c) => {
		return c.text(
			"This is an ActorCore server.\n\nLearn more at https://actorcore.org",
		);
	});

	app.get("/health", (c) => {
		return c.text("ok");
	});

	// Resolve actor ID from query
	app.post("/actors/resolve", async (c) => {
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
	});

	app.get("/actors/connect/websocket", async (c) => {
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
	});

	// Proxy SSE connection to actor
	app.get("/actors/connect/sse", async (c) => {
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
	});

	// Proxy RPC calls to actor
	app.post("/actors/rpc/:rpc", async (c) => {
		try {
			const rpcName = c.req.param("rpc");
			logger().debug("rpc call received", { rpcName });

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
			logger().debug("found actor for rpc", { actorId, meta });
			invariant(actorId, "Missing actor ID");

			// Handle based on mode
			if ("inline" in handler.proxyMode) {
				logger().debug("using inline proxy mode for rpc call");
				// Use shared RPC handler with direct parameter
				return handleRpc(
					c,
					appConfig,
					driverConfig,
					handler.proxyMode.inline.handlers.onRpc,
					rpcName,
					actorId,
				);
			} else if ("custom" in handler.proxyMode) {
				logger().debug("using custom proxy mode for rpc call");
				const url = new URL(`http://actor/rpc/${encodeURIComponent(rpcName)}`);
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
			logger().error("error in rpc handler", { error });

			// Use ProxyError if it's not already an ActorError
			if (!(error instanceof errors.ActorError)) {
				throw new errors.ProxyError("RPC call", error);
			} else {
				throw error;
			}
		}
	});

	// Proxy connection messages to actor
	app.post("/actors/message", async (c) => {
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
			if (!(error instanceof errors.ActorError)) {
				throw new errors.ProxyError("connection message", error);
			} else {
				throw error;
			}
		}
	});

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

	app.notFound(handleRouteNotFound);
	app.onError(handleRouteError);

	return app;
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

/** Generates a `Next` handler to pass to middleware in order to be able to call arbitrary middleware. */
function noopNext(): Next {
	return async () => {};
}
