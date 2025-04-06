import { Hono, type HonoRequest } from "hono";
import type { UpgradeWebSocket, WSContext } from "hono/ws";
import * as errors from "./errors";
import { logger } from "./log";
import { type Encoding, EncodingSchema } from "@/actor/protocol/serde";
import { parseMessage } from "@/actor/protocol/message/mod";
import * as protoHttpRpc from "@/actor/protocol/http/rpc";
import type * as messageToServer from "@/actor/protocol/message/to-server";
import type { InputData } from "@/actor/protocol/serde";
import { type SSEStreamingApi, streamSSE } from "hono/streaming";
import { cors } from "hono/cors";
import { assertUnreachable } from "./utils";
import { handleRouteError, handleRouteNotFound } from "@/common/router";
import { deconstructError, stringifyError } from "@/common/utils";
import type { DriverConfig } from "@/driver-helpers/config";
import type { AppConfig } from "@/app/config";
import {
	type ActorInspectorConnHandler,
	createActorInspectorRouter,
} from "@/inspector/actor";

export interface ConnectWebSocketOpts {
	req: HonoRequest;
	encoding: Encoding;
	params: unknown;
}

export interface ConnectWebSocketOutput {
	onOpen: (ws: WSContext) => Promise<void>;
	onMessage: (message: messageToServer.ToServer) => Promise<void>;
	onClose: () => Promise<void>;
}

export interface ConnectSseOpts {
	req: HonoRequest;
	encoding: Encoding;
	params: unknown;
}

export interface ConnectSseOutput {
	onOpen: (stream: SSEStreamingApi) => Promise<void>;
	onClose: () => Promise<void>;
}

export interface RpcOpts {
	req: HonoRequest;
	params: unknown;
	rpcName: string;
	rpcArgs: unknown[];
}

export interface RpcOutput {
	output: unknown;
}

export interface ConnsMessageOpts {
	req: HonoRequest;
	connId: string;
	connToken: string;
	message: messageToServer.ToServer;
}

export interface ActorRouterHandler {
	// Pass this value directly from Hono
	upgradeWebSocket?: UpgradeWebSocket;

	onConnectWebSocket?(
		opts: ConnectWebSocketOpts,
	): Promise<ConnectWebSocketOutput>;
	onConnectSse(opts: ConnectSseOpts): Promise<ConnectSseOutput>;
	onRpc(opts: RpcOpts): Promise<RpcOutput>;
	onConnMessage(opts: ConnsMessageOpts): Promise<void>;
	onConnectInspector?: ActorInspectorConnHandler;
}

/**
 * Creates a router that handles requests for the protocol and passes it off to the handler.
 *
 * This allows for creating a universal protocol across all platforms.
 */
export function createActorRouter(
	appConfig: AppConfig,
	driverConfig: DriverConfig,
	handler: ActorRouterHandler,
): Hono {
	const app = new Hono();

	// Apply CORS middleware if configured
	if (appConfig.cors) {
		app.use("*", async (c, next) => {
			const path = c.req.path;

			// Don't apply to WebSocket routes, see https://hono.dev/docs/helpers/websocket#upgradewebsocket
			if (path === "/connect/websocket" || path === "/inspect") {
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

	if (handler.upgradeWebSocket && handler.onConnectWebSocket) {
		app.get(
			"/connect/websocket",
			handler.upgradeWebSocket(async (c) => {
				try {
					if (!handler.onConnectWebSocket)
						throw new Error("onConnectWebSocket is not implemented");

					const encoding = getRequestEncoding(c.req);
					const parameters = getRequestConnParams(
						c.req,
						appConfig,
						driverConfig,
					);

					const wsHandler = await handler.onConnectWebSocket({
						req: c.req,
						encoding,
						params: parameters,
					});

					const { promise: onOpenPromise, resolve: onOpenResolve } =
						Promise.withResolvers<undefined>();
					return {
						onOpen: async (_evt, ws) => {
							try {
								logger().debug("websocket open");

								// Call handler
								await wsHandler.onOpen(ws);

								// Resolve promise
								onOpenResolve(undefined);
							} catch (error) {
								const { code } = deconstructError(error, logger(), {
									wsEvent: "open",
								});
								ws.close(1011, code);
							}
						},
						onMessage: async (evt, ws) => {
							try {
								await onOpenPromise;

								logger().debug("received message");

								const value = evt.data.valueOf() as InputData;
								const message = await parseMessage(value, {
									encoding: encoding,
									maxIncomingMessageSize: appConfig.maxIncomingMessageSize,
								});

								await wsHandler.onMessage(message);
							} catch (error) {
								const { code } = deconstructError(error, logger(), {
									wsEvent: "message",
								});
								ws.close(1011, code);
							}
						},
						onClose: async (_evt) => {
							try {
								await onOpenPromise;

								logger().debug("websocket closed");

								await wsHandler.onClose();
							} catch (error) {
								deconstructError(error, logger(), { wsEvent: "close" });
							}
						},
						onError: async (error) => {
							try {
								await onOpenPromise;

								// Actors don't need to know about this, since it's abstracted
								// away
								logger().warn("websocket error", {
									error: stringifyError(error),
								});
							} catch (error) {
								deconstructError(error, logger(), { wsEvent: "error" });
							}
						},
					};
				} catch (error) {
					deconstructError(error, logger(), {});
					return {};
				}
			}),
		);
	} else {
		app.get("/connect/websocket", (c) => {
			return c.text(
				"WebSockets are not enabled for this driver. Use SSE instead.",
				400,
			);
		});
	}

	app.get("/connect/sse", async (c) => {
		const encoding = getRequestEncoding(c.req);
		const parameters = getRequestConnParams(c.req, appConfig, driverConfig);

		const sseHandler = await handler.onConnectSse({
			req: c.req,
			encoding,
			params: parameters,
		});

		return streamSSE(
			c,
			async (stream) => {
				// Create connection with validated parameters
				logger().debug("sse stream open");

				await sseHandler.onOpen(stream);

				const { promise, resolve } = Promise.withResolvers();

				stream.onAbort(() => {
					sseHandler.onClose();

					resolve(undefined);
				});

				await promise;
			},
			async (error) => {
				// Actors don't need to know about this, since it's abstracted
				// away
				logger().warn("sse error", { error: stringifyError(error) });
			},
		);
	});

	app.post("/rpc/:rpc", async (c) => {
		const rpcName = c.req.param("rpc");
		try {
			// TODO: Support multiple encodings
			const encoding: Encoding = "json";
			const parameters = getRequestConnParams(c.req, appConfig, driverConfig);

			// Parse request body if present
			const contentLength = Number(c.req.header("content-length") || "0");
			if (contentLength > appConfig.maxIncomingMessageSize) {
				throw new errors.MessageTooLong();
			}

			// Parse request body according to encoding
			const body = await c.req.json();
			const { data: message, success } =
				protoHttpRpc.RequestSchema.safeParse(body);
			if (!success) {
				throw new errors.MalformedMessage("Invalid request format");
			}
			const rpcArgs = message.a;

			// Callback
			const { output } = await handler.onRpc({
				req: c.req,
				params: parameters,
				rpcName,
				rpcArgs,
			});

			// Format response according to encoding
			return c.json({
				o: output,
			} satisfies protoHttpRpc.ResponseOk);
		} catch (error) {
			// Build response error information similar to WebSocket handling

			const { statusCode, code, message, metadata } = deconstructError(
				error,
				logger(),
				{ rpc: rpcName },
			);

			return c.json(
				{
					c: code,
					m: message,
					md: metadata,
				} satisfies protoHttpRpc.ResponseErr,
				{ status: statusCode },
			);
		}
	});

	app.post("/connections/:conn/message", async (c) => {
		try {
			const encoding = getRequestEncoding(c.req);

			const connId = c.req.param("conn");
			if (!connId) {
				throw new errors.ConnNotFound(connId);
			}

			const connToken = c.req.query("connectionToken");
			if (!connToken) throw new errors.IncorrectConnToken();

			// Parse request body if present
			const contentLength = Number(c.req.header("content-length") || "0");
			if (contentLength > appConfig.maxIncomingMessageSize) {
				throw new errors.MessageTooLong();
			}

			// Read body
			let value: InputData;
			if (encoding === "json") {
				// Handle decoding JSON in handleMessageEvent
				value = await c.req.text();
			} else if (encoding === "cbor") {
				value = await c.req.arrayBuffer();
			} else {
				assertUnreachable(encoding);
			}

			// Parse message
			const message = await parseMessage(value, {
				encoding,
				maxIncomingMessageSize: appConfig.maxIncomingMessageSize,
			});

			await handler.onConnMessage({
				req: c.req,
				connId,
				connToken,
				message,
			});

			// Not data to return
			return c.json({});
		} catch (error) {
			// Build response error information similar to WebSocket handling
			const { statusCode, code, message, metadata } = deconstructError(
				error,
				logger(),
				{},
			);

			return c.json(
				{
					c: code,
					m: message,
					md: metadata,
				} satisfies protoHttpRpc.ResponseErr,
				{ status: statusCode },
			);
		}
	});

	if (appConfig.inspector.enabled) {
		app.route(
			"/inspect",
			createActorInspectorRouter(
				handler.upgradeWebSocket,
				handler.onConnectInspector,
				appConfig.inspector,
			),
		);
	}

	app.notFound(handleRouteNotFound);
	app.onError(handleRouteError);

	return app;
}

function getRequestEncoding(req: HonoRequest): Encoding {
	const encodingRaw = req.query("encoding");
	const { data: encoding, success } = EncodingSchema.safeParse(encodingRaw);
	if (!success) {
		logger().warn("invalid encoding", {
			encoding: encodingRaw,
		});
		throw new errors.InvalidEncoding(encodingRaw);
	}

	return encoding;
}

function getRequestConnParams(
	req: HonoRequest,
	appConfig: AppConfig,
	driverConfig: DriverConfig,
): unknown {
	// Validate params size
	const paramsStr = req.query("params");
	if (paramsStr && paramsStr.length > appConfig.maxConnParamLength) {
		logger().warn("connection parameters too long");
		throw new errors.ConnParamsTooLong();
	}

	// Parse and validate params
	try {
		return typeof paramsStr === "string" ? JSON.parse(paramsStr) : undefined;
	} catch (error) {
		logger().warn("malformed connection parameters", {
			error: stringifyError(error),
		});
		throw new errors.MalformedConnParams(error);
	}
}
