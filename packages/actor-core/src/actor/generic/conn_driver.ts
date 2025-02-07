import type { AnyActor } from "@/actor/runtime/actor";
import { Connection } from "@/actor/runtime/connection";
import { WSContext } from "hono/ws";
import { logger } from "@/actor/runtime/log";
import { CachedSerializer, Encoding } from "@/actor/protocol/serde";
import { ConnectionDriver } from "@/actor/runtime/driver";
import * as messageToClient from "@/actor/protocol/message/to_client";
import { SSEStreamingApi } from "hono/streaming";
import { encodeDataToString } from "@/actor/protocol/serde";

// This state is different than the connection-specific state since the connection-specific state is persisted & must be serializable.
//
// This holds the actual connections, which are not serializable.
export interface GenericDriverGlobalState {
	websockets: Map<string, WSContext>;
	sseStreams: Map<string, SSEStreamingApi>;
}

export function createGenericDriverGlobalState(): GenericDriverGlobalState {
	return {
		websockets: new Map(),
		sseStreams: new Map(),
	};
}

/**
 * Exposes generic connection drivers for platforms that support vanilla WebSocket, SSE, and HTTP.
 */
export function createGenericConnectionDrivers(
	driverGlobal: GenericDriverGlobalState,
): Record<string, ConnectionDriver> {
	return {
		[CONN_DRIVER_WEBSOCKET]: createWebSocketDriver(driverGlobal),
		[CONN_DRIVER_SSE]: createSseDriver(driverGlobal),
		[CONN_DRIVER_HTTP]: createHttpDriver(),
	};
}

// MARK: WebSocket
export const CONN_DRIVER_WEBSOCKET = "websocket";

export interface WebSocketDriverState {
	encoding: Encoding;
}

export function createWebSocketDriver(
	driverGlobal: GenericDriverGlobalState,
): ConnectionDriver<WebSocketDriverState> {
	return {
		sendMessage: (
			_actor: AnyActor,
			conn: Connection<AnyActor>,
			state: WebSocketDriverState,
			message: CachedSerializer<messageToClient.ToClient>,
		) => {
			const ws = driverGlobal.websockets.get(conn.id);
			if (!ws) {
				logger().warn("missing ws for sendMessage", { connId: conn.id });
				return;
			}
			ws.send(message.serialize(state.encoding));
		},

		disconnect: async (
			_actor: AnyActor,
			conn: Connection<AnyActor>,
			_state: WebSocketDriverState,
			reason?: string,
		) => {
			const ws = driverGlobal.websockets.get(conn.id);
			if (!ws) {
				logger().warn("missing ws for disconnect", { connId: conn.id });
				return;
			}

			const raw = ws.raw as WebSocket;
			if (!raw) {
				logger().warn("ws.raw does not exist");
				return;
			}

			// Create promise to wait for socket to close gracefully
			const { promise, resolve } = Promise.withResolvers<void>();
			raw.addEventListener("close", () => resolve());

			// Close socket
			ws.close(1000, reason);

			await promise;
		},
	};
}

// MARK: SSE
export const CONN_DRIVER_SSE = "sse";

export interface SseDriverState {
	encoding: Encoding;
}

export function createSseDriver(driverGlobal: GenericDriverGlobalState) {
	return {
		sendMessage: (
			_actor: AnyActor,
			conn: Connection<AnyActor>,
			state: SseDriverState,
			message: CachedSerializer<messageToClient.ToClient>,
		) => {
			const stream = driverGlobal.sseStreams.get(conn.id);
			if (!stream) {
				logger().warn("missing sse stream for sendMessage", {
					connId: conn.id,
				});
				return;
			}
			stream.writeSSE({
				data: encodeDataToString(message.serialize(state.encoding)),
			});
		},

		disconnect: async (
			_actor: AnyActor,
			conn: Connection<AnyActor>,
			_state: SseDriverState,
			reason?: string,
		) => {
			const stream = driverGlobal.sseStreams.get(conn.id);
			if (!stream) {
				logger().warn("missing sse stream for disconnect", { connId: conn.id });
				return;
			}

			stream.close();
		},
	};
}

// MARK: HTTP
export const CONN_DRIVER_HTTP = "http";

export type HttpDriverState = Record<never, never>;

export function createHttpDriver() {
	return {
		sendMessage: () => {
			logger().warn("attempting to send message to http connection");
		},

		disconnect: async () => {
			// Noop
		},
	};
}
