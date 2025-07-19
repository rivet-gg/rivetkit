import { type Encoding, noopNext } from "@rivetkit/core";
import type { Context as HonoContext } from "hono";
import invariant from "invariant";
import { logger } from "../log";
import { RelayConn } from "../relay-conn";
import { LeaderChangedError } from "./message";
import type { Node } from "./mod";
import type { NodeMessage } from "./protocol";

export async function proxyWebSocket(
	node: Node,
	c: HonoContext,
	path: string,
	actorId: string,
	encoding: Encoding,
	connParams: unknown,
	authData: unknown,
): Promise<Response> {
	const upgradeWebSocket = node.runConfig.getUpgradeWebSocket?.();
	invariant(upgradeWebSocket, "missing getUpgradeWebSocket");

	let clientWs: any;

	// Open connection
	const relayConn = new RelayConn(
		node.registryConfig,
		node.runConfig,
		node.driverConfig,
		node.actorDriver,
		node.inlineClient,
		node.coordinateDriver,
		node.globalState,
		{
			disconnect: async (reason: string) => {
				clientWs?.close(1000, reason);
			},
		},
		actorId,
	);
	await relayConn.start();

	// Create WebSocket ID
	const websocketId = crypto.randomUUID();

	return upgradeWebSocket(() => ({
		onOpen: (event: any, ws: any) => {
			clientWs = ws;

			logger().debug("proxy websocket onOpen called", {
				websocketId,
				actorId,
				path,
			});

			// Store WebSocket reference
			node.globalState.followerWebSockets =
				node.globalState.followerWebSockets || new Map();
			node.globalState.followerWebSockets.set(websocketId, {
				ws,
				relayConn,
			});

			// Open websocket (with retry)
			const openMessage: NodeMessage = {
				b: {
					lwo: {
						ai: actorId,
						wi: websocketId,
						url: path,
						e: encoding,
						cp: connParams,
						ad: authData,
					},
				},
			};

			logger().debug("sending websocket open message to leader", {
				websocketId,
				actorId,
			});

			const _promise = relayConn.publishMessageToleader(openMessage, true);
		},
		onMessage: (event: any, ws: any) => {
			const wsData = node.globalState.followerWebSockets.get(websocketId);
			if (!wsData) return;

			// Handle different data types
			if (event.data instanceof ArrayBuffer) {
				// Send ArrayBuffer directly
				const data = new Uint8Array(event.data);
				try {
					const message: NodeMessage = {
						b: {
							lwm: {
								wi: websocketId,
								data,
								binary: true,
							},
						},
					};
					const _promise = relayConn.publishMessageToleader(message, false);
				} catch (error) {
					// If leader changed, close the WebSocket
					if (error instanceof LeaderChangedError) {
						ws.close(1001, "Actor leader changed");
						node.globalState.followerWebSockets.delete(websocketId);
					}
					// Otherwise, ignore the error - the message is lost
				}
			} else if (event.data instanceof Blob) {
				// Handle Blob asynchronously
				event.data
					.arrayBuffer()
					.then((arrayBuffer: ArrayBuffer) => {
						const data = new Uint8Array(arrayBuffer);
						try {
							const message: NodeMessage = {
								b: {
									lwm: {
										wi: websocketId,
										data,
										binary: true,
									},
								},
							};
							const _promise = relayConn.publishMessageToleader(message, false);
						} catch (error) {
							// If leader changed, close the WebSocket
							if (error instanceof LeaderChangedError) {
								ws.close(1001, "Actor leader changed");
								node.globalState.followerWebSockets.delete(websocketId);
							}
							// Otherwise, ignore the error - the message is lost
						}
					})
					.catch((error: any) => {
						logger().error("failed to convert blob to arraybuffer", { error });
					});
			} else {
				// Send string/other data directly
				try {
					const message: NodeMessage = {
						b: {
							lwm: {
								wi: websocketId,
								data: event.data,
								binary: false,
							},
						},
					};
					const _promise = relayConn.publishMessageToleader(message, false);
				} catch (error) {
					// If leader changed, close the WebSocket
					if (error instanceof LeaderChangedError) {
						ws.close(1001, "Actor leader changed");
						node.globalState.followerWebSockets.delete(websocketId);
					}
					// Otherwise, ignore the error - the message is lost
				}
			}
		},
		onClose: (event: any, ws: any) => {
			const wsData = node.globalState.followerWebSockets?.get(websocketId);
			if (!wsData) return;

			// Disconnect from leader
			const _promise = relayConn.disconnect(false, "Client closed WebSocket", {
				b: {
					lwc: {
						wi: websocketId,
						code: event.code,
						reason: event.reason,
					},
				},
			});

			// Clean up
			node.globalState.followerWebSockets.delete(websocketId);
		},
	}))(c, noopNext());
}
