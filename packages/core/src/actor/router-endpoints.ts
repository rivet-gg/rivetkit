import type { HonoRequest, Context as HonoContext } from "hono";
import { type SSEStreamingApi, streamSSE } from "hono/streaming";
import type { WSContext } from "hono/ws";
import * as errors from "./errors";
import { logger } from "./log";
import {
	type Encoding,
	EncodingSchema,
	serialize,
	deserialize,
} from  "@/actor/protocol/serde";
import { parseMessage } from  "@/actor/protocol/message/mod";
import * as protoHttpAction from  "@/actor/protocol/http/action";
import type * as messageToServer from  "@/actor/protocol/message/to-server";
import type { InputData } from  "@/actor/protocol/serde";
import { assertUnreachable } from "./utils";
import { deconstructError, stringifyError } from "@/common/utils";
import type { RegistryConfig } from "@/registry/config";
import { DriverConfig, RunConfig } from "@/registry/run-config";

export interface ConnectWebSocketOpts {
	req?: HonoRequest;
	encoding: Encoding;
	actorId: string;
	params: unknown;
	authData: unknown;
}

export interface ConnectWebSocketOutput {
	onOpen: (ws: WSContext) => Promise<void>;
	onMessage: (message: messageToServer.ToServer) => Promise<void>;
	onClose: () => Promise<void>;
}

export interface ConnectSseOpts {
	req?: HonoRequest;
	encoding: Encoding;
	params: unknown;
	actorId: string;
	authData: unknown;
}

export interface ConnectSseOutput {
	onOpen: (stream: SSEStreamingApi) => Promise<void>;
	onClose: () => Promise<void>;
}

export interface ActionOpts {
	req?: HonoRequest;
	params: unknown;
	actionName: string;
	actionArgs: unknown[];
	actorId: string;
	authData: unknown;
}

export interface ActionOutput {
	output: unknown;
}

export interface ConnsMessageOpts {
	req?: HonoRequest;
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
	onAction(opts: ActionOpts): Promise<ActionOutput>;
	onConnMessage(opts: ConnsMessageOpts): Promise<void>;
}

/**
 * Creates a WebSocket connection handler
 */
export function handleWebSocketConnect(
	context: HonoContext,
	registryConfig: RegistryConfig,
	runConfig: RunConfig,
	handler: (opts: ConnectWebSocketOpts) => Promise<ConnectWebSocketOutput>,
	actorId: string,
	encoding: Encoding,
	params: unknown,
	authData: unknown,
) {
	const exposeInternalError = getRequestExposeInternalError(context.req);

	// Setup promise for the init message since all other behavior depends on this
	const {
		promise: wsHandlerPromise,
		resolve: wsHandlerResolve,
		reject: wsHandlerReject,
	} = Promise.withResolvers<ConnectWebSocketOutput>();

	return {
		onOpen: async (_evt: any, ws: WSContext) => {
			logger().debug("websocket open");

			try {
				// Create connection handler
				const wsHandler = await handler({
					req: context.req,
					encoding,
					params,
					actorId,
					authData,
				});

				// Notify socket open
				// TODO: Add timeout to this
				await wsHandler.onOpen(ws);

				// Unblock other uses of WS handler
				wsHandlerResolve(wsHandler);
			} catch (error) {
				wsHandlerReject(error);

				const { code } = deconstructError(
					error,
					logger(),
					{
						wsEvent: "message",
					},
					exposeInternalError,
				);
				ws.close(1011, code);
			}
		},
		onMessage: async (evt: { data: any }, ws: WSContext) => {
			try {
				const wsHandler = await wsHandlerPromise;

				const value = evt.data.valueOf() as InputData;
				const message = await parseMessage(value, {
					encoding: encoding,
					maxIncomingMessageSize: runConfig.maxIncomingMessageSize,
				});

				await wsHandler.onMessage(message);
			} catch (error) {
				const { code } = deconstructError(
					error,
					logger(),
					{
						wsEvent: "message",
					},
					exposeInternalError,
				);
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

			// HACK: Close socket in order to fix bug with Cloudflare leaving WS in closing state
			// https://github.com/cloudflare/workerd/issues/2569
			ws.close(1000, "hack_force_close");

			try {
				const wsHandler = await wsHandlerPromise;
				await wsHandler.onClose();
			} catch (error) {
				deconstructError(
					error,
					logger(),
					{ wsEvent: "close" },
					exposeInternalError,
				);
			}
		},
		onError: async (_error: unknown) => {
			try {
				// Actors don't need to know about this, since it's abstracted away
				logger().warn("websocket error");
			} catch (error) {
				deconstructError(
					error,
					logger(),
					{ wsEvent: "error" },
					exposeInternalError,
				);
			}
		},
	};
}

/**
 * Creates an SSE connection handler
 */
export async function handleSseConnect(
	c: HonoContext,
	registryConfig: RegistryConfig,
	runConfig: RunConfig,
	handler: (opts: ConnectSseOpts) => Promise<ConnectSseOutput>,
	actorId: string,
	authData: unknown,
) {
	const encoding = getRequestEncoding(c.req);
	const parameters = getRequestConnParams(c.req, registryConfig, runConfig);

	const sseHandler = await handler({
		req: c.req,
		encoding,
		params: parameters,
		actorId,
		authData,
	});

	return streamSSE(c, async (stream) => {
		try {
			await sseHandler.onOpen(stream);
			logger().debug("sse open");

			// HACK: This is required so the abort handler below works
			//
			// See https://github.com/honojs/hono/issues/1770#issuecomment-2461966225
			stream.onAbort(() => {});

			// Wait for close
			const abortResolver = Promise.withResolvers();
			c.req.raw.signal.addEventListener("abort", async () => {
				try {
					logger().debug("sse shutting down");
					await sseHandler.onClose();
					abortResolver.resolve(undefined);
				} catch (error) {
					logger().error("error closing sse connection", { error });
				}
			});

			// HACK: Will throw if not configured
			try {
				c.executionCtx.waitUntil(abortResolver.promise);
			} catch {}

			// Wait until connection aborted
			await abortResolver.promise;
		} catch (error) {
			logger().error("error opening sse connection", { error });
			throw error;
		}
	});
}

/**
 * Creates an action handler
 */
export async function handleAction(
	c: HonoContext,
	registryConfig: RegistryConfig,
	runConfig: RunConfig,
	handler: (opts: ActionOpts) => Promise<ActionOutput>,
	actionName: string,
	actorId: string,
	authData: unknown,
) {
	const encoding = getRequestEncoding(c.req);
	const parameters = getRequestConnParams(c.req, registryConfig, runConfig);

	logger().debug("handling action", { actionName, encoding });

	// Validate incoming request
	let actionArgs: unknown[];
	if (encoding === "json") {
		try {
			actionArgs = await c.req.json();
		} catch (err) {
			throw new errors.InvalidActionRequest("Invalid JSON");
		}

		if (!Array.isArray(actionArgs)) {
			throw new errors.InvalidActionRequest(
				"Action arguments must be an array",
			);
		}
	} else if (encoding === "cbor") {
		try {
			const value = await c.req.arrayBuffer();
			const uint8Array = new Uint8Array(value);
			const deserialized = await deserialize(
				uint8Array as unknown as InputData,
				encoding,
			);

			// Validate using the action schema
			const result =
				protoHttpAction.ActionRequestSchema.safeParse(deserialized);
			if (!result.success) {
				throw new errors.InvalidActionRequest("Invalid action request format");
			}

			actionArgs = result.data.a;
		} catch (err) {
			throw new errors.InvalidActionRequest(
				`Invalid binary format: ${stringifyError(err)}`,
			);
		}
	} else {
		return assertUnreachable(encoding);
	}

	// Invoke the action
	const result = await handler({
		req: c.req,
		params: parameters,
		actionName: actionName,
		actionArgs: actionArgs,
		actorId,
		authData,
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
}

/**
 * Create a connection message handler
 */
export async function handleConnectionMessage(
	c: HonoContext,
	registryConfig: RegistryConfig,
	runConfig: RunConfig,
	handler: (opts: ConnsMessageOpts) => Promise<void>,
	connId: string,
	connToken: string,
	actorId: string,
) {
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
				maxIncomingMessageSize: runConfig.maxIncomingMessageSize,
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
}

// Helper to get the connection encoding from a request
export function getRequestEncoding(req: HonoRequest): Encoding {
	const encodingParam = req.header(HEADER_ENCODING);
	if (!encodingParam) {
		throw new errors.InvalidEncoding("undefined");
	}

	const result = EncodingSchema.safeParse(encodingParam);
	if (!result.success) {
		throw new errors.InvalidEncoding(encodingParam as string);
	}

	return result.data;
}

export function getRequestExposeInternalError(req: HonoRequest): boolean {
	const param = req.header(HEADER_EXPOSE_INTERNAL_ERROR);
	if (!param) {
		return false;
	}

	return param === "true";
}

export function getRequestQuery(c: HonoContext): unknown {
	// Get query parameters for actor lookup
	const queryParam = c.req.header(HEADER_ACTOR_QUERY);
	if (!queryParam) {
		logger().error("missing query parameter");
		throw new errors.InvalidRequest("missing query");
	}

	// Parse the query JSON and validate with schema
	try {
		const parsed = JSON.parse(queryParam);
		return parsed;
	} catch (error) {
		logger().error("invalid query json", { error });
		throw new errors.InvalidQueryJSON(error);
	}
}

export const HEADER_ACTOR_QUERY = "X-RivetKit-Query";

export const HEADER_ENCODING = "X-RivetKit-Encoding";

// Internal header
export const HEADER_EXPOSE_INTERNAL_ERROR = "X-RivetKit-Expose-Internal-Error";

// IMPORTANT: Params must be in headers or in an E2EE part of the request (i.e. NOT the URL or query string) in order to ensure that tokens can be securely passed in params.
export const HEADER_CONN_PARAMS = "X-RivetKit-Conn-Params";

// Internal header
export const HEADER_AUTH_DATA = "X-RivetKit-Auth-Data";

export const HEADER_ACTOR_ID = "X-RivetKit-Actor";

export const HEADER_CONN_ID = "X-RivetKit-Conn";

export const HEADER_CONN_TOKEN = "X-RivetKit-Conn-Token";

/**
 * Headers that publics can send from public clients.
 *
 * Used for CORS.
 **/
export const ALL_PUBLIC_HEADERS = [
	HEADER_ACTOR_QUERY,
	HEADER_ENCODING,
	HEADER_CONN_PARAMS,
	HEADER_ACTOR_ID,
	HEADER_CONN_ID,
	HEADER_CONN_TOKEN,
];

// Helper to get connection parameters for the request
export function getRequestConnParams(
	req: HonoRequest,
	registryConfig: RegistryConfig,
	runConfig: RunConfig,
): unknown {
	const paramsParam = req.header(HEADER_CONN_PARAMS);
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
