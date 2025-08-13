import type { RunConfig } from "@rivetkit/core";
import {
	handleRawWebSocketHandler,
	handleWebSocketConnect,
	PATH_CONNECT_WEBSOCKET,
	PATH_RAW_WEBSOCKET_PREFIX,
	toUint8Array,
	type UpgradeWebSocketArgs,
} from "@rivetkit/core";
import type { ActorDriver } from "@rivetkit/core/driver-helpers";
import {
	HEADER_AUTH_DATA,
	HEADER_CONN_PARAMS,
	HEADER_ENCODING,
} from "@rivetkit/core/driver-helpers";
import { ActorPeer } from "../../actor-peer";
import type { CoordinateDriver } from "../../driver";
import { logger } from "../../log";
import type { GlobalState } from "../../types";
import type {
	NodeMessage,
	ToLeaderWebSocketClose,
	ToLeaderWebSocketMessage,
	ToLeaderWebSocketOpen,
} from "../protocol";

interface WebSocketData {
	wsHandler: any;
	wsContext: any;
	actorId: string;
}

export async function handleLeaderWebSocketOpen(
	globalState: GlobalState,
	coordinateDriver: CoordinateDriver,
	runConfig: RunConfig,
	actorDriver: ActorDriver,
	nodeId: string | undefined,
	open: ToLeaderWebSocketOpen,
) {
	if (!nodeId) {
		logger().error("node id not provided for leader websocket open");
		return;
	}

	logger().debug("handling leader websocket open", {
		nodeId,
		websocketId: open.wi,
		actorId: open.ai,
		url: open.url,
	});

	try {
		const actor = await ActorPeer.getLeaderActor(globalState, open.ai);
		if (!actor) {
			logger().warn("received websocket open for nonexistent actor leader", {
				actorId: open.ai,
			});
			return;
		}

		// Parse the URL to determine the path
		const url = new URL(`ws://actor${open.url}`);
		const path = url.pathname;
		const pathWithQuery = url.pathname + url.search;

		// Get the appropriate WebSocket handler based on path
		let wsHandler: UpgradeWebSocketArgs;
		if (path === PATH_CONNECT_WEBSOCKET) {
			// Handle standard /connect/websocket
			wsHandler = await handleWebSocketConnect(
				undefined,
				runConfig,
				actorDriver,
				open.ai,
				open.e,
				open.cp,
				open.ad,
			);
		} else if (path.startsWith(PATH_RAW_WEBSOCKET_PREFIX)) {
			// Handle websocket proxy (/raw/websocket/*)
			wsHandler = await handleRawWebSocketHandler(
				undefined,
				pathWithQuery,
				actorDriver,
				open.ai,
				open.ad,
			);
		} else {
			throw new Error(`Unreachable path: ${path}`);
		}

		// Create a fake WebSocket context that relays messages to follower
		const fakeWsContext = {
			send: (data: any) => {
				// Convert data and send via relay
				const isBinary =
					data instanceof ArrayBuffer || ArrayBuffer.isView(data);
				const encodedData = isBinary ? toUint8Array(data) : data;

				const message: NodeMessage = {
					b: {
						fwm: {
							wi: open.wi,
							data: encodedData,
							binary: isBinary,
						},
					},
				};
				coordinateDriver.publishToNode(nodeId, message);
			},
			close: (code?: number, reason?: string) => {
				const message: NodeMessage = {
					b: {
						fwc: {
							wi: open.wi,
							code,
							reason,
						},
					},
				};
				coordinateDriver.publishToNode(nodeId, message);
			},
		};

		// Store handler reference
		(globalState as any).leaderWebSockets =
			(globalState as any).leaderWebSockets || new Map();
		(globalState as any).leaderWebSockets.set(open.wi, {
			wsHandler,
			wsContext: fakeWsContext,
			actorId: open.ai,
		});

		// Send open confirmation to follower
		logger().debug("sending websocket open confirmation to follower", {
			websocketId: open.wi,
			nodeId,
			actorId: open.ai,
		});
		const openMessage: NodeMessage = {
			b: {
				fwo: {
					wi: open.wi,
				},
			},
		};
		await coordinateDriver.publishToNode(nodeId, openMessage);
		logger().debug("websocket open confirmation sent", {
			websocketId: open.wi,
		});

		// Call onOpen
		//
		// Do this after sending the open message to the client in order to ensure that messages are published after the open message
		wsHandler.onOpen({}, fakeWsContext as any);
	} catch (error) {
		logger().warn("failed to open websocket", { error: `${error}` });

		// Send close message
		const message: NodeMessage = {
			b: {
				fwc: {
					wi: open.wi,
					code: 1011, // Internal error
					reason:
						error instanceof Error ? error.message : "Internal server error",
				},
			},
		};
		await coordinateDriver.publishToNode(nodeId, message);
	}
}

export async function handleLeaderWebSocketMessage(
	globalState: GlobalState,
	message: ToLeaderWebSocketMessage,
) {
	const wsData = (globalState as any).leaderWebSockets?.get(message.wi);
	if (!wsData) {
		logger().warn("received websocket message for nonexistent websocket", {
			websocketId: message.wi,
		});
		return;
	}

	const actor = await ActorPeer.getLeaderActor(globalState, wsData.actorId);
	if (!actor) {
		logger().warn("received websocket message for nonexistent actor leader", {
			actorId: wsData.actorId,
		});
		return;
	}

	// Decode message
	const data = message.binary
		? message.data instanceof Uint8Array
			? message.data
			: new Uint8Array(
					atob(message.data)
						.split("")
						.map((c) => c.charCodeAt(0)),
				)
		: message.data;

	// Forward to handler
	if (wsData.wsHandler && wsData.wsHandler.onMessage) {
		wsData.wsHandler.onMessage({ data }, wsData.wsContext);
	}
}

export async function handleLeaderWebSocketClose(
	globalState: GlobalState,
	close: ToLeaderWebSocketClose,
) {
	const wsData = (globalState as any).leaderWebSockets?.get(close.wi);
	if (!wsData) {
		logger().warn("received websocket close for nonexistent websocket", {
			websocketId: close.wi,
		});
		return;
	}

	// Clean up
	(globalState as any).leaderWebSockets.delete(close.wi);

	// Forward to handler
	if (wsData.wsHandler && wsData.wsHandler.onClose) {
		wsData.wsHandler.onClose(
			{
				wasClean: true,
				code: close.code ?? 1005,
				reason: close.reason ?? "",
			},
			wsData.wsContext,
		);
	}
}
