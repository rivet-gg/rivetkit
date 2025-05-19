import { Hono, Next, type Context as HonoContext } from "hono";
import { cors } from "hono/cors";
import { logger } from "./log";
import {
	handleRouteError,
	handleRouteNotFound,
	loggerMiddleware,
} from "@/common/router";
import type { DriverConfig } from "@/driver-helpers/config";
import type { AppConfig } from "@/app/config";
import {
	createManagerInspectorRouter,
	type ManagerInspectorConnHandler,
} from "@/inspector/manager";
import { ConnectQuerySchema } from "./protocol/query";
import * as errors from "@/actor/errors";
import type { ActorQuery } from "./protocol/query";
import { assertUnreachable } from "@/actor/utils";
import invariant from "invariant";
import {
	type ConnectionHandlers,
	handleSseConnect,
	handleRpc,
	handleConnectionMessage,
	getRequestEncoding,
	handleWebSocketConnect,
} from "@/actor/router_endpoints";
import { ManagerDriver } from "./driver";
import { Encoding, serialize } from "@/actor/protocol/serde";
import { deconstructError } from "@/common/utils";
import { WSContext } from "hono/ws";
import { ToClient } from "@/actor/protocol/message/to-client";
import { streamSSE } from "hono/streaming";

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
		app.use("*", async (c, next) => {
			const path = c.req.path;

			// Don't apply to WebSocket routes
			if (path === "/actors/connect/websocket") {
				return next();
			}

			return cors(appConfig.cors)(c, next);
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

	app.get("/actors/connect/websocket", async (c) => {
		invariant(upgradeWebSocket, "WebSockets not supported");

		let encoding: Encoding | undefined;
		try {
			encoding = getRequestEncoding(c.req);
			logger().debug("websocket connection request received", { encoding });

			const params = ConnectQuerySchema.safeParse({
				query: parseQuery(c),
				encoding: c.req.query("encoding"),
				params: c.req.query("params"),
			});
			if (!params.success) {
				logger().error("invalid connection parameters", {
					error: params.error,
				});
				throw new errors.InvalidQueryFormat(params.error);
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
				let pathname = `/connect/websocket?encoding=${params.data.encoding}`;
				if (params.data.params) {
					pathname += `&params=${params.data.params}`;
				}
				return await handler.proxyMode.custom.onProxyWebSocket(
					c,
					pathname,
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
			encoding = getRequestEncoding(c.req);
			logger().debug("sse connection request received", { encoding });

			const params = ConnectQuerySchema.safeParse({
				query: parseQuery(c),
				encoding: c.req.query("encoding"),
				params: c.req.query("params"),
			});

			if (!params.success) {
				logger().error("invalid connection parameters", {
					error: params.error,
				});
				throw new errors.InvalidQueryFormat(params.error);
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
				url.searchParams.set("encoding", params.data.encoding);
				if (params.data.params) {
					url.searchParams.set("params", params.data.params);
				}
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

			// Get query parameters for actor lookup
			const queryParam = c.req.query("query");
			if (!queryParam) {
				logger().error("missing query parameter for rpc");
				throw new errors.MissingRequiredParameters(["query"]);
			}

			// Parse the query JSON and validate with schema
			let parsedQuery: ActorQuery;
			try {
				parsedQuery = JSON.parse(queryParam as string);
			} catch (error) {
				logger().error("invalid query json for rpc", { error });
				throw new errors.InvalidQueryJSON(error);
			}

			// Get the actor ID and meta
			const { actorId, meta } = await queryActor(c, parsedQuery, driver);
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
	app.post("/actors/connections/:conn/message", async (c) => {
		logger().debug("connection message request received");
		try {
			const connId = c.req.param("conn");
			const connToken = c.req.query("connectionToken");
			const encoding = c.req.query("encoding");

			// Get query parameters for actor lookup
			const queryParam = c.req.query("query");
			if (!queryParam) {
				throw new errors.MissingRequiredParameters(["query"]);
			}

			// Check other required parameters
			const missingParams: string[] = [];
			if (!connToken) missingParams.push("connectionToken");
			if (!encoding) missingParams.push("encoding");

			if (missingParams.length > 0) {
				throw new errors.MissingRequiredParameters(missingParams);
			}

			// Parse the query JSON and validate with schema
			let parsedQuery: ActorQuery;
			try {
				parsedQuery = JSON.parse(queryParam as string);
			} catch (error) {
				logger().error("invalid query json", { error });
				throw new errors.InvalidQueryJSON(error);
			}

			// Get the actor ID and meta
			const { actorId, meta } = await queryActor(c, parsedQuery, driver);
			invariant(actorId, "Missing actor ID");
			logger().debug("connection message to actor", { connId, actorId, meta });

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
				url.searchParams.set("connectionToken", connToken!);
				url.searchParams.set("encoding", encoding!);
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
		throw new errors.InvalidQueryFormat("Invalid query format");
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

function parseQuery(c: HonoContext): unknown {
	// Get query parameters for actor lookup
	const queryParam = c.req.query("query");
	if (!queryParam) {
		logger().error("missing query parameter for rpc");
		throw new errors.MissingRequiredParameters(["query"]);
	}

	// Parse the query JSON and validate with schema
	try {
		const parsed = JSON.parse(queryParam as string);
		return parsed;
	} catch (error) {
		logger().error("invalid query json for rpc", { error });
		throw new errors.InvalidQueryJSON(error);
	}
}
