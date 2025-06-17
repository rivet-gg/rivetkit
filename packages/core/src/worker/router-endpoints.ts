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
} from "@/worker/protocol/serde";
import { parseMessage } from "@/worker/protocol/message/mod";
import * as protoHttpAction from "@/worker/protocol/http/action";
import type * as messageToServer from "@/worker/protocol/message/to-server";
import type { InputData, OutputData } from "@/worker/protocol/serde";
import { assertUnreachable } from "./utils";
import { deconstructError, stringifyError } from "@/common/utils";
import type { RegistryConfig } from "@/registry/config";
import type { DriverConfig } from "@/driver-helpers/config";
import invariant from "invariant";

export interface ConnectWebSocketOpts {
	req?: HonoRequest;
	encoding: Encoding;
	params: unknown;
	workerId: string;
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
	workerId: string;
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
	workerId: string;
}

export interface ActionOutput {
	output: unknown;
}

export interface ConnsMessageOpts {
	req?: HonoRequest;
	connId: string;
	connToken: string;
	message: messageToServer.ToServer;
	workerId: string;
}

/**
 * Shared interface for connection handlers used by both WorkerRouterHandler and ManagerRouterHandler
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
	driverConfig: DriverConfig,
	handler: (opts: ConnectWebSocketOpts) => Promise<ConnectWebSocketOutput>,
	workerId: string,
) {
	return async () => {
		const encoding = getRequestEncoding(context.req, true);
		const exposeInternalError = getRequestExposeInternalError(
			context.req,
			false,
		);

		let sharedWs: WSContext | undefined = undefined;

		// Setup promise for the init message since all other behavior depends on this
		const {
			promise: onInitPromise,
			resolve: onInitResolve,
			reject: onInitReject,
		} = Promise.withResolvers<ConnectWebSocketOutput>();

		let didTimeOut = false;
		let didInit = false;

		// Add timeout waiting for init
		const initTimeout = setTimeout(() => {
			logger().warn("timed out waiting for init");

			sharedWs?.close(1001, "timed out waiting for init message");
			didTimeOut = true;
			onInitReject("init timed out");
		}, registryConfig.webSocketInitTimeout);

		return {
			onOpen: async (_evt: any, ws: WSContext) => {
				sharedWs = ws;

				logger().debug("websocket open");

				// Close WS immediately if init timed out. This indicates a long delay at the protocol level in sending the init message.
				if (didTimeOut) ws.close(1001, "timed out waiting for init message");
			},
			onMessage: async (evt: { data: any }, ws: WSContext) => {
				try {
					const value = evt.data.valueOf() as InputData;
					const message = await parseMessage(value, {
						encoding: encoding,
						maxIncomingMessageSize: registryConfig.maxIncomingMessageSize,
					});

					if ("i" in message.b) {
						// Handle init message
						//
						// Parameters must go over the init message instead of a query parameter so it receives full E2EE

						logger().debug("received init ws message");

						invariant(
							!didInit,
							"should not have already received init message",
						);
						didInit = true;
						clearTimeout(initTimeout);

						try {
							// Create connection handler
							const wsHandler = await handler({
								req: context.req,
								encoding,
								params: message.b.i.p,
								workerId,
							});

							// Notify socket open
							// TODO: Add timeout to this
							await wsHandler.onOpen(ws);

							// Allow all other events to proceed
							onInitResolve(wsHandler);
						} catch (error) {
							deconstructError(
								error,
								logger(),
								{ wsEvent: "open" },
								exposeInternalError,
							);
							onInitReject(error);
							ws.close(1011, "internal error");
						}
					} else {
						// Handle all other messages

						logger().debug("received regular ws message");

						const wsHandler = await onInitPromise;
						await wsHandler.onMessage(message);
					}
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
					const wsHandler = await onInitPromise;
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
					// Workers don't need to know about this, since it's abstracted away
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
	};
}

/**
 * Creates an SSE connection handler
 */
export async function handleSseConnect(
	c: HonoContext,
	registryConfig: RegistryConfig,
	driverConfig: DriverConfig,
	handler: (opts: ConnectSseOpts) => Promise<ConnectSseOutput>,
	workerId: string,
) {
	const encoding = getRequestEncoding(c.req, false);
	const parameters = getRequestConnParams(c.req, registryConfig, driverConfig);

	const sseHandler = await handler({
		req: c.req,
		encoding,
		params: parameters,
		workerId,
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
	driverConfig: DriverConfig,
	handler: (opts: ActionOpts) => Promise<ActionOutput>,
	actionName: string,
	workerId: string,
) {
	const encoding = getRequestEncoding(c.req, false);
	const parameters = getRequestConnParams(c.req, registryConfig, driverConfig);

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
		workerId,
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
	handler: (opts: ConnsMessageOpts) => Promise<void>,
	connId: string,
	connToken: string,
	workerId: string,
) {
	const encoding = getRequestEncoding(c.req, false);

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
				maxIncomingMessageSize: registryConfig.maxIncomingMessageSize,
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
		workerId,
	});

	return c.json({});
}

// Helper to get the connection encoding from a request
export function getRequestEncoding(
	req: HonoRequest,
	useQuery: boolean,
): Encoding {
	const encodingParam = useQuery
		? req.query("encoding")
		: req.header(HEADER_ENCODING);
	if (!encodingParam) {
		return "json";
	}

	const result = EncodingSchema.safeParse(encodingParam);
	if (!result.success) {
		throw new errors.InvalidEncoding(encodingParam as string);
	}

	return result.data;
}

export function getRequestExposeInternalError(
	req: HonoRequest,
	useQuery: boolean,
): boolean {
	const param = useQuery
		? req.query("expose-internal-error")
		: req.header(HEADER_EXPOSE_INTERNAL_ERROR);
	if (!param) {
		return false;
	}

	return param === "true";
}

export function getRequestQuery(c: HonoContext, useQuery: boolean): unknown {
	// Get query parameters for worker lookup
	const queryParam = useQuery
		? c.req.query("query")
		: c.req.header(HEADER_WORKER_QUERY);
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

export const HEADER_WORKER_QUERY = "X-AC-Query";

export const HEADER_ENCODING = "X-AC-Encoding";
export const HEADER_EXPOSE_INTERNAL_ERROR = "X-AC-Expose-Internal-Error";

// IMPORTANT: Params must be in headers or in an E2EE part of the request (i.e. NOT the URL or query string) in order to ensure that tokens can be securely passed in params.
export const HEADER_CONN_PARAMS = "X-AC-Conn-Params";

export const HEADER_WORKER_ID = "X-AC-Worker";

export const HEADER_CONN_ID = "X-AC-Conn";

export const HEADER_CONN_TOKEN = "X-AC-Conn-Token";

export const ALL_HEADERS = [
	HEADER_WORKER_QUERY,
	HEADER_ENCODING,
	HEADER_CONN_PARAMS,
	HEADER_WORKER_ID,
	HEADER_CONN_ID,
	HEADER_CONN_TOKEN,
];

// Helper to get connection parameters for the request
export function getRequestConnParams(
	req: HonoRequest,
	registryConfig: RegistryConfig,
	driverConfig: DriverConfig,
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
