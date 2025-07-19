import { logger } from "../../log";
import type { GlobalState } from "../../types";
import type {
	ToFollowerWebSocketClose,
	ToFollowerWebSocketMessage,
	ToFollowerWebSocketOpen,
} from "../protocol";

export async function handleFollowerWebSocketOpen(
	globalState: GlobalState,
	open: ToFollowerWebSocketOpen,
) {
	logger().debug("handling follower websocket open", {
		websocketId: open.wi,
		hasRelayWebSockets: !!globalState.relayWebSockets,
		relayWebSocketsSize: globalState.relayWebSockets?.size ?? 0,
		hasFollowerWebSockets: !!globalState.followerWebSockets,
		followerWebSocketsSize: globalState.followerWebSockets?.size ?? 0,
	});

	// Check for relay WebSocket adapter
	const relayWs = globalState.relayWebSockets?.get(open.wi);
	if (relayWs) {
		logger().debug("calling _handleOpen on relay websocket", {
			websocketId: open.wi,
		});
		relayWs._handleOpen();
		return;
	}

	// Check for follower WebSocket (proxyWebSocket)
	const followerWs = globalState.followerWebSockets?.get(open.wi);
	if (followerWs) {
		// For proxy websockets, the client WebSocket is already open
		// This message confirms the actor-side WebSocket is also ready
		logger().debug("follower websocket open confirmed by leader", {
			websocketId: open.wi,
		});
		return;
	}

	logger().warn("received websocket open for nonexistent follower websocket", {
		websocketId: open.wi,
		allRelayWebSocketIds: Array.from(globalState.relayWebSockets?.keys() ?? []),
		allFollowerWebSocketIds: Array.from(
			globalState.followerWebSockets?.keys() ?? [],
		),
	});
}

export async function handleFollowerWebSocketMessage(
	globalState: GlobalState,
	message: ToFollowerWebSocketMessage,
) {
	// Check for raw WebSocket first
	const ws = globalState.rawWebSockets.get(message.wi);
	if (ws) {
		// Forward message - handle binary data properly
		if (message.data instanceof Uint8Array) {
			// Convert Uint8Array to ArrayBuffer for WebSocket
			ws.send(
				message.data.buffer.slice(
					message.data.byteOffset,
					message.data.byteOffset + message.data.byteLength,
				),
			);
		} else {
			ws.send(message.data);
		}
		return;
	}

	// Check for relay WebSocket adapter
	const relayWs = globalState.relayWebSockets?.get(message.wi);
	if (relayWs) {
		relayWs._handleMessage(message.data, message.binary);
		return;
	}

	// Check for follower WebSocket (proxyWebSocket)
	const followerWs = globalState.followerWebSockets?.get(message.wi);
	if (followerWs) {
		logger().debug("forwarding message to follower websocket", {
			websocketId: message.wi,
			isBinary: message.binary,
			dataType: typeof message.data,
			dataLength:
				typeof message.data === "string"
					? message.data.length
					: message.data.byteLength,
		});

		// Handle binary data properly
		if (message.data instanceof Uint8Array) {
			// Convert Uint8Array to ArrayBuffer for WebSocket
			followerWs.ws.send(
				message.data.buffer.slice(
					message.data.byteOffset,
					message.data.byteOffset + message.data.byteLength,
				),
			);
		} else {
			followerWs.ws.send(message.data);
		}
		return;
	}

	logger().warn(
		"received websocket message for nonexistent follower websocket",
		{
			websocketId: message.wi,
		},
	);
}

export async function handleFollowerWebSocketClose(
	globalState: GlobalState,
	close: ToFollowerWebSocketClose,
) {
	// Check for raw WebSocket first
	const ws = globalState.rawWebSockets.get(close.wi);
	if (ws) {
		globalState.rawWebSockets.delete(close.wi);
		ws.close(close.code, close.reason);
		return;
	}

	// Check for relay WebSocket adapter
	const relayWs = globalState.relayWebSockets?.get(close.wi);
	if (relayWs) {
		relayWs._handleClose(close.code, close.reason);
		globalState.relayWebSockets.delete(close.wi);
		return;
	}

	// Check for follower WebSocket (proxyWebSocket)
	const followerWs = globalState.followerWebSockets?.get(close.wi);
	if (followerWs) {
		followerWs.ws.close(close.code, close.reason);
		globalState.followerWebSockets.delete(close.wi);
		return;
	}

	logger().warn("received websocket close for nonexistent follower websocket", {
		websocketId: close.wi,
	});
}
