import { type HonoRequest, type Context as HonoContext } from "hono";
import { type SSEStreamingApi, streamSSE } from "hono/streaming";
import { type WSContext } from "hono/ws";
import * as errors from "./errors";
import { logger } from "./log";
import {
	type Encoding,
	EncodingSchema,
	serialize,
	deserialize,
	CachedSerializer,
} from "@/actor/protocol/serde";
import { parseMessage } from "@/actor/protocol/message/mod";
import * as protoHttpRpc from "@/actor/protocol/http/rpc";
import type * as messageToServer from "@/actor/protocol/message/to-server";
import type { InputData, OutputData } from "@/actor/protocol/serde";
import { assertUnreachable } from "./utils";
import { deconstructError, stringifyError } from "@/common/utils";
import type { AppConfig } from "@/app/config";
import type { DriverConfig } from "@/driver-helpers/config";
import { ToClient } from "./protocol/message/to-client";
import invariant from "invariant";

export interface ConnectWebSocketOpts {
	req: HonoRequest;
	encoding: Encoding;
	params: unknown;
	actorId: string;
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
	actorId: string;
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
	actorId: string;
}

export interface RpcOutput {
	output: unknown;
}

export interface ConnsMessageOpts {
	req: HonoRequest;
	connId: string;
	connToken: string;
	message: messageToServer.ToServer;
	actorId: string;
}

/**
 * Shared interface for connection handlers used by both ActorRouterHandler and ManagerRouterHandler
 */
export interface ConnectionHandlers {
	onConnectWebSocket?(
		opts: ConnectWebSocketOpts,
	): Promise<ConnectWebSocketOutput>;
	onConnectSse(opts: ConnectSseOpts): Promise<ConnectSseOutput>;
	onRpc(opts: RpcOpts): Promise<RpcOutput>;
	onConnMessage(opts: ConnsMessageOpts): Promise<void>;
}

/**
 * Creates a WebSocket connection handler
 */
export function handleWebSocketConnect(
	context: HonoContext,
	appConfig: AppConfig,
	driverConfig: DriverConfig,
	handler: (opts: ConnectWebSocketOpts) => Promise<ConnectWebSocketOutput>,
	actorId: string,
) {
	return async () => {
		const encoding = getRequestEncoding(context.req);

		const parameters = getRequestConnParams(
			context.req,
			appConfig,
			driverConfig,
		);

		// Continue with normal connection setup
		const wsHandler = await handler({
			req: context.req,
			encoding,
			params: parameters,
			actorId,
		});

		const { promise: onOpenPromise, resolve: onOpenResolve } =
			Promise.withResolvers<undefined>();

		return {
			onOpen: async (_evt: any, ws: WSContext) => {
				try {
					// TODO: maybe timeout this!
					await wsHandler.onOpen(ws);
					onOpenResolve(undefined);
				} catch (error) {
					deconstructError(error, logger(), { wsEvent: "open" });
					onOpenResolve(undefined);
					ws.close(1011, "internal error");
				}
			},
			onMessage: async (evt: { data: any }, ws: WSContext) => {
				try {
					invariant(encoding, "encoding should be defined");

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
			onClose: async (
				event: {
					wasClean: boolean;
					code: number;
					reason: string;
				},
				ws: WSContext,
			) => {
				try {
					await onOpenPromise;

					// HACK: Close socket in order to fix bug with Cloudflare Durable Objects leaving WS in closing state
					// https://github.com/cloudflare/workerd/issues/2569
					ws.close(1000, "hack_force_close");

					if (event.wasClean) {
						logger().info("websocket closed", {
							code: event.code,
							reason: event.reason,
							wasClean: event.wasClean,
						});
					} else {
						logger().warn("websocket closed", {
							code: event.code,
							reason: event.reason,
							wasClean: event.wasClean,
						});
					}

					await wsHandler.onClose();
				} catch (error) {
					deconstructError(error, logger(), { wsEvent: "close" });
				}
			},
			onError: async (error: unknown) => {
				try {
					await onOpenPromise;

					// Actors don't need to know about this, since it's abstracted away
					logger().warn("websocket error");
				} catch (error) {
					deconstructError(error, logger(), { wsEvent: "error" });
				}
			},
		};
	};
}

/**
 * Creates an SSE connection handler
 */
export async function handleSseConnect(
	c: HonoContext,
	appConfig: AppConfig,
	driverConfig: DriverConfig,
	handler: (opts: ConnectSseOpts) => Promise<ConnectSseOutput>,
	actorId: string,
) {
	const encoding = getRequestEncoding(c.req);
	const parameters = getRequestConnParams(c.req, appConfig, driverConfig);

	const sseHandler = await handler({
		req: c.req,
		encoding,
		params: parameters,
		actorId,
	});

	return streamSSE(c, async (stream) => {
		try {
			await sseHandler.onOpen(stream);

			// Wait for close
			const abortResolver = Promise.withResolvers();
			c.req.raw.signal.addEventListener("abort", async () => {
				try {
					abortResolver.resolve(undefined);
					await sseHandler.onClose();
				} catch (error) {
					logger().error("error closing sse connection", { error });
				}
			});

			// Wait until connection aborted
			await abortResolver.promise;
		} catch (error) {
			logger().error("error opening sse connection", { error });
			throw error;
		}
	});
}

/**
 * Creates an RPC handler
 */
export async function handleRpc(
	c: HonoContext,
	appConfig: AppConfig,
	driverConfig: DriverConfig,
	handler: (opts: RpcOpts) => Promise<RpcOutput>,
	rpcName: string,
	actorId: string,
) {
	try {
		const encoding = getRequestEncoding(c.req);
		const parameters = getRequestConnParams(c.req, appConfig, driverConfig);

		// Validate incoming request
		let rpcArgs: unknown[];
		if (encoding === "json") {
			try {
				rpcArgs = await c.req.json();
			} catch (err) {
				throw new errors.InvalidRpcRequest("Invalid JSON");
			}

			if (!Array.isArray(rpcArgs)) {
				throw new errors.InvalidRpcRequest("RPC arguments must be an array");
			}
		} else if (encoding === "cbor") {
			try {
				const value = await c.req.arrayBuffer();
				const uint8Array = new Uint8Array(value);
				const deserialized = await deserialize(
					uint8Array as unknown as InputData,
					encoding,
				);

				// Validate using the RPC schema
				const result = protoHttpRpc.RequestSchema.safeParse(deserialized);
				if (!result.success) {
					throw new errors.InvalidRpcRequest("Invalid RPC request format");
				}

				rpcArgs = result.data.a;
			} catch (err) {
				throw new errors.InvalidRpcRequest(
					`Invalid binary format: ${stringifyError(err)}`,
				);
			}
		} else {
			return assertUnreachable(encoding);
		}

		// Invoke the RPC
		const result = await handler({
			req: c.req,
			params: parameters,
			rpcName,
			rpcArgs,
			actorId,
		});

		// Encode the response
		if (encoding === "json") {
			return c.json(result.output as Record<string, unknown>);
		} else if (encoding === "cbor") {
			// Use serialize from serde.ts instead of custom encoder
			const responseData = {
				o: result.output, // Use the format expected by ResponseOkSchema
			};
			const serialized = serialize(responseData, encoding);

			return c.body(serialized as Uint8Array, 200, {
				"Content-Type": "application/octet-stream",
			});
		} else {
			return assertUnreachable(encoding);
		}
	} catch (err) {
		if (err instanceof errors.ActorError) {
			return c.json({ error: err.serializeForHttp() }, 400);
		} else {
			logger().error("error executing rpc", { err });
			return c.json(
				{
					error: {
						type: "internal_error",
						message: "An internal error occurred",
					},
				},
				500,
			);
		}
	}
}

/**
 * Create a connection message handler
 */
export async function handleConnectionMessage(
	c: HonoContext,
	appConfig: AppConfig,
	handler: (opts: ConnsMessageOpts) => Promise<void>,
	connId: string,
	connToken: string,
	actorId: string,
) {
	try {
		const encoding = getRequestEncoding(c.req);

		// Validate incoming request
		let message: messageToServer.ToServer;
		if (encoding === "json") {
			try {
				message = await c.req.json();
			} catch (err) {
				throw new errors.InvalidRequest("Invalid JSON");
			}
		} else if (encoding === "cbor") {
			try {
				const value = await c.req.arrayBuffer();
				const uint8Array = new Uint8Array(value);
				message = await parseMessage(uint8Array as unknown as InputData, {
					encoding,
					maxIncomingMessageSize: appConfig.maxIncomingMessageSize,
				});
			} catch (err) {
				throw new errors.InvalidRequest(
					`Invalid binary format: ${stringifyError(err)}`,
				);
			}
		} else {
			return assertUnreachable(encoding);
		}

		await handler({
			req: c.req,
			connId,
			connToken,
			message,
			actorId,
		});

		return c.json({});
	} catch (err) {
		if (err instanceof errors.ActorError) {
			return c.json({ error: err.serializeForHttp() }, 400);
		} else {
			logger().error("error processing connection message", { err });
			return c.json(
				{
					error: {
						type: "internal_error",
						message: "An internal error occurred",
					},
				},
				500,
			);
		}
	}
}

// Helper to get the connection encoding from a request
export function getRequestEncoding(req: HonoRequest): Encoding {
	const encodingParam = req.query("encoding");
	if (!encodingParam) {
		return "json";
	}

	const result = EncodingSchema.safeParse(encodingParam);
	if (!result.success) {
		throw new errors.InvalidEncoding(encodingParam as string);
	}

	return result.data;
}

// Helper to get connection parameters for the request
export function getRequestConnParams(
	req: HonoRequest,
	appConfig: AppConfig,
	driverConfig: DriverConfig,
): unknown {
	const paramsParam = req.query("params");
	if (!paramsParam) {
		return null;
	}

	try {
		return JSON.parse(paramsParam);
	} catch (err) {
		throw new errors.InvalidParams(
			`Invalid params JSON: ${stringifyError(err)}`,
		);
	}
}
