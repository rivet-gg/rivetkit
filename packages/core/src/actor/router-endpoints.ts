import type { Context as HonoContext, HonoRequest } from "hono";
import { type SSEStreamingApi, streamSSE } from "hono/streaming";
import type { WSContext } from "hono/ws";
import { ActionContext } from "@/actor/action";
import type { AnyConn } from "@/actor/connection";
import { generateConnId, generateConnToken } from "@/actor/connection";
import * as errors from "@/actor/errors";
import type { AnyActorInstance } from "@/actor/instance";
import * as protoHttpAction from "@/actor/protocol/http/action";
import { parseMessage } from "@/actor/protocol/message/mod";
import type * as messageToServer from "@/actor/protocol/message/to-server";
import type { InputData } from "@/actor/protocol/serde";
import {
	deserialize,
	type Encoding,
	EncodingSchema,
	serialize,
} from "@/actor/protocol/serde";
import type { UpgradeWebSocketArgs } from "@/common/inline-websocket-adapter2";
import { deconstructError, stringifyError } from "@/common/utils";
import type { UniversalWebSocket } from "@/common/websocket-interface";
import { HonoWebSocketAdapter } from "@/manager/hono-websocket-adapter";
import type { RunConfig } from "@/registry/run-config";
import type { ActorDriver } from "./driver";
import {
	CONN_DRIVER_GENERIC_HTTP,
	CONN_DRIVER_GENERIC_SSE,
	CONN_DRIVER_GENERIC_WEBSOCKET,
	type GenericHttpDriverState,
	type GenericSseDriverState,
	type GenericWebSocketDriverState,
} from "./generic-conn-driver";
import { logger } from "./log";
import { assertUnreachable } from "./utils";

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

export interface FetchOpts {
	request: Request;
	actorId: string;
	authData: unknown;
}

export interface WebSocketOpts {
	request: Request;
	websocket: UniversalWebSocket;
	actorId: string;
	authData: unknown;
}

/**
 * Creates a WebSocket connection handler
 */
export function handleWebSocketConnect(
	c: HonoContext | undefined,
	runConfig: RunConfig,
	actorDriver: ActorDriver,
	actorId: string,
	encoding: Encoding,
	parameters: unknown,
	authData: unknown,
): UpgradeWebSocketArgs {
	const exposeInternalError = c ? getRequestExposeInternalError(c.req) : false;

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
				const actor = await actorDriver.loadActor(actorId);

				const connId = generateConnId();
				const connToken = generateConnToken();
				const connState = await actor.prepareConn(parameters, c?.req.raw);

				let conn: AnyConn | undefined;
				const wsHandler: ConnectWebSocketOutput = {
					onOpen: async (ws) => {
						// Save socket
						actorDriver
							.getGenericConnGlobalState(actorId)
							.websockets.set(connId, ws);

						// Create connection
						conn = await actor.createConn(
							connId,
							connToken,
							parameters,
							connState,
							CONN_DRIVER_GENERIC_WEBSOCKET,
							{ encoding } satisfies GenericWebSocketDriverState,
							authData,
						);
					},
					onMessage: async (message) => {
						logger().debug("received message");

						if (!conn) {
							logger().warn("`conn` does not exist");
							return;
						}

						await actor.processMessage(message, conn);
					},
					onClose: async () => {
						actorDriver
							.getGenericConnGlobalState(actorId)
							.websockets.delete(connId);

						if (conn) {
							actor.__removeConn(conn);
						}
					},
				};

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
	runConfig: RunConfig,
	actorDriver: ActorDriver,
	actorId: string,
	authData: unknown,
) {
	const encoding = getRequestEncoding(c.req);
	const parameters = getRequestConnParams(c.req);

	const actor = await actorDriver.loadActor(actorId);

	const connId = generateConnId();
	const connToken = generateConnToken();
	const connState = await actor.prepareConn(parameters, c.req.raw);

	let conn: AnyConn | undefined;
	const sseHandler = {
		onOpen: async (stream: SSEStreamingApi) => {
			// Save socket
			actorDriver
				.getGenericConnGlobalState(actorId)
				.sseStreams.set(connId, stream);

			// Create connection
			conn = await actor.createConn(
				connId,
				connToken,
				parameters,
				connState,
				CONN_DRIVER_GENERIC_SSE,
				{ encoding } satisfies GenericSseDriverState,
				authData,
			);
		},
		onClose: async () => {
			actorDriver.getGenericConnGlobalState(actorId).sseStreams.delete(connId);

			if (conn) {
				actor.__removeConn(conn);
			}
		},
	};

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
	runConfig: RunConfig,
	actorDriver: ActorDriver,
	actionName: string,
	actorId: string,
	authData: unknown,
) {
	const encoding = getRequestEncoding(c.req);
	const parameters = getRequestConnParams(c.req);

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
	let actor: AnyActorInstance | undefined;
	let conn: AnyConn | undefined;
	let output: unknown | undefined;
	try {
		actor = await actorDriver.loadActor(actorId);

		// Create conn
		const connState = await actor.prepareConn(parameters, c.req.raw);
		conn = await actor.createConn(
			generateConnId(),
			generateConnToken(),
			parameters,
			connState,
			CONN_DRIVER_GENERIC_HTTP,
			{} satisfies GenericHttpDriverState,
			authData,
		);

		// Call action
		const ctx = new ActionContext(actor.actorContext!, conn!);
		output = await actor.executeAction(ctx, actionName, actionArgs);
	} finally {
		if (conn) {
			actor?.__removeConn(conn);
		}
	}

	// Encode the response
	if (encoding === "json") {
		return c.json(output as Record<string, unknown>);
	} else if (encoding === "cbor") {
		// Use serialize from serde.ts instead of custom encoder
		const responseData = {
			o: output, // Use the format expected by ResponseOkSchema
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
	runConfig: RunConfig,
	actorDriver: ActorDriver,
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
		} catch (_err) {
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

	const actor = await actorDriver.loadActor(actorId);

	// Find connection
	const conn = actor.conns.get(connId);
	if (!conn) {
		throw new errors.ConnNotFound(connId);
	}

	// Authenticate connection
	if (conn._token !== connToken) {
		throw new errors.IncorrectConnToken();
	}

	// Process message
	await actor.processMessage(message, conn);

	return c.json({});
}

export function handleRawWebSocketHandler(
	c: HonoContext | undefined,
	path: string,
	actorDriver: ActorDriver,
	actorId: string,
	authData: unknown,
) {
	// Return WebSocket event handlers
	return {
		onOpen: async (_evt: any, ws: any) => {
			const actor = await actorDriver.loadActor(actorId);

			// TODO: This isn't a clean way of handling paths
			// Create a new request with the corrected URL
			const originalPath = path.replace(/^\/websocket/, "") || "/";
			let newRequest: Request;
			if (c) {
				newRequest = new Request(`http://actor${originalPath}`, c.req.raw);
			} else {
				newRequest = new Request(`http://actor${originalPath}`, {
					method: "GET",
				});
			}

			// Wrap the Hono WebSocket in our adapter
			const adapter = new HonoWebSocketAdapter(ws);

			// Store adapter reference on the WebSocket for event handlers
			(ws as any).__adapter = adapter;

			// Call the actor's onWebSocket handler with the adapted WebSocket
			await actor.handleWebSocket(adapter, {
				request: newRequest,
				auth: authData,
			});
		},
		onMessage: async (event: any, ws: any) => {
			// Find the adapter for this WebSocket
			const adapter = (ws as any).__adapter;
			if (adapter) {
				adapter._handleMessage(event);
			}
		},
		onClose: async (evt: any, ws: any) => {
			// Find the adapter for this WebSocket
			const adapter = (ws as any).__adapter;
			if (adapter) {
				adapter._handleClose(evt?.code || 1006, evt?.reason || "");
			}
		},
		onError: async (error: any, ws: any) => {
			// Find the adapter for this WebSocket
			const adapter = (ws as any).__adapter;
			if (adapter) {
				adapter._handleError(error);
			}
		},
	};
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
export const ALLOWED_PUBLIC_HEADERS = [
	"Content-Type",
	"User-Agent",
	HEADER_ACTOR_QUERY,
	HEADER_ENCODING,
	HEADER_CONN_PARAMS,
	HEADER_ACTOR_ID,
	HEADER_CONN_ID,
	HEADER_CONN_TOKEN,
];

// Helper to get connection parameters for the request
export function getRequestConnParams(req: HonoRequest): unknown {
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
