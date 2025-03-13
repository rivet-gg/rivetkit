import { Handler, Hono, Context as HonoContext, HonoRequest } from "hono";
import { ContentfulStatusCode } from "hono/utils/http-status";
import type { UpgradeWebSocket, WSContext, WSEvents } from "hono/ws";
import * as errors from "../errors";
import { logger } from "./log";
import { type Encoding, EncodingSchema } from "@/actor/protocol/serde";
import { type BaseConfig } from "./config";
import { parseMessage } from "@/actor/protocol/message/mod";
import * as protoHttpRpc from "@/actor/protocol/http/rpc";
import * as messageToServer from "@/actor/protocol/message/to_server";
import type { InputData } from "@/actor/protocol/serde";
import { SSEStreamingApi, streamSSE } from "hono/streaming";
import { cors } from "hono/cors";
import { assertUnreachable } from "./utils";
import { createInspectorRouter, InspectorConnectionHandler } from "./inspect";
import { handleRouteError, handleRouteNotFound } from "@/common/router";
import { deconstructError } from "@/common/utils";

export interface ConnectWebSocketOpts {
	req: HonoRequest;
	encoding: Encoding;
	parameters: unknown;
}

export interface ConnectWebSocketOutput {
	onOpen: (ws: WSContext) => Promise<void>;
	onMessage: (message: messageToServer.ToServer) => Promise<void>;
	onClose: () => Promise<void>;
}

export interface ConnectSseOpts {
	req: HonoRequest;
	encoding: Encoding;
	parameters: unknown;
}

export interface ConnectSseOutput {
	onOpen: (stream: SSEStreamingApi) => Promise<void>;
	onClose: () => Promise<void>;
}

export interface RpcOpts {
	req: HonoRequest;
	parameters: unknown;
	rpcName: string;
	rpcArgs: unknown[];
}

export interface RpcOutput {
	output: unknown;
}

export interface ConnectionsMessageOpts {
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
	onConnectionsMessage(opts: ConnectionsMessageOpts): Promise<void>;
	onConnectInspector?: InspectorConnectionHandler;
}

/**
 * Creates a router that handles requests for the protocol and passes it off to the handler.
 *
 * This allows for creating a universal protocol across all platforms.
 */
export function createActorRouter(
	config: BaseConfig,
	handler: ActorRouterHandler,
): Hono {
	const app = new Hono();

	// Apply CORS middleware if configured
	if (config.cors) {
		app.use("*", cors(config.cors));
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
					const parameters = getRequestConnectionParameters(c.req, config);

					const wsHandler = await handler.onConnectWebSocket({
						req: c.req,
						encoding,
						parameters,
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
									maxIncomingMessageSize: config.maxIncomingMessageSize,
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
								logger().warn("websocket error", { error: `${error}` });
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
		const parameters = getRequestConnectionParameters(c.req, config);

		const sseHandler = await handler.onConnectSse({
			req: c.req,
			encoding,
			parameters,
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
				logger().warn("sse error", { error: `${error}` });
			},
		);
	});

	app.post("/rpc/:rpc", async (c) => {
		const rpcName = c.req.param("rpc");
		try {
			// TODO: Support multiple encodings
			const encoding: Encoding = "json";
			const parameters = getRequestConnectionParameters(c.req, config);

			// Parse request body if present
			const contentLength = Number(c.req.header("content-length") || "0");
			if (contentLength > config.maxIncomingMessageSize) {
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
				parameters,
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
				throw new errors.ConnectionNotFound(connId);
			}

			const connToken = c.req.query("connectionToken");
			if (!connToken) throw new errors.IncorrectConnectionToken();

			// Parse request body if present
			const contentLength = Number(c.req.header("content-length") || "0");
			if (contentLength > config.maxIncomingMessageSize) {
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
				maxIncomingMessageSize: config.maxIncomingMessageSize,
			});

			await handler.onConnectionsMessage({
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

	app.route(
		"/inspect",
		createInspectorRouter(handler.upgradeWebSocket, handler.onConnectInspector),
	);

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

function getRequestConnectionParameters(
	req: HonoRequest,
	config: BaseConfig,
): unknown {
	// Validate params size
	const paramsStr = req.query("params");
	if (paramsStr && paramsStr.length > config.maxConnectionParametersSize) {
		logger().warn("connection parameters too long");
		throw new errors.ConnectionParametersTooLong();
	}

	// Parse and validate params
	try {
		return typeof paramsStr === "string" ? JSON.parse(paramsStr) : undefined;
	} catch (error) {
		logger().warn("malformed connection parameters", {
			error: `${error}`,
		});
		throw new errors.MalformedConnectionParameters(error);
	}
}
