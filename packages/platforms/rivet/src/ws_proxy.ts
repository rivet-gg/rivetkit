import { upgradeWebSocket } from "hono/deno";
import { WSContext } from "hono/ws";
import { Context } from "hono";
import { logger } from "./log";
import invariant from "invariant";

/**
 * Creates a WebSocket proxy to forward connections to a target endpoint
 *
 * @param c Hono context
 * @param targetUrl Target WebSocket URL to proxy to
 * @returns Response with upgraded WebSocket
 */
export function createWebSocketProxy(c: Context, targetUrl: string) {
	return upgradeWebSocket((c) => {
		let targetWs: WebSocket | undefined = undefined;
		const messageQueue: any[] = [];

		return {
			onOpen: (_evt: any, wsContext: WSContext) => {
				// Create target WebSocket connection
				targetWs = new WebSocket(targetUrl);

				// Set up target websocket handlers
				targetWs.onopen = () => {
					invariant(targetWs, "targetWs does not exist");

					// Process any queued messages once connected
					if (messageQueue.length > 0) {
						for (const data of messageQueue) {
							targetWs.send(data);
						}
						// Clear the queue after sending
						messageQueue.length = 0;
					}
				};

				targetWs.onmessage = (event) => {
					wsContext.send(event.data);
				};

				targetWs.onclose = (event) => {
					logger().debug("target websocket closed", {
						code: event.code,
						reason: event.reason,
					});

					if (wsContext.readyState === WebSocket.OPEN) {
						// Forward the close code and reason from target to client
						wsContext.close(event.code, event.reason);
					}
				};

				targetWs.onerror = (event) => {
					logger().warn("target websocket error");

					if (wsContext.readyState === WebSocket.OPEN) {
						// Use standard WebSocket error code: 1006 - Abnormal Closure
						// The connection was closed abnormally, e.g., without sending or receiving a Close control frame
						wsContext.close(1006, "Error in target connection");
					}
				};
			},

			// Handle messages from client to target
			onMessage: (evt: { data: any }, wsContext: WSContext) => {
				invariant(targetWs, "targetWs not defined");

				// If the WebSocket is OPEN, send immediately
				if (targetWs.readyState === WebSocket.OPEN) {
					targetWs.send(evt.data);
				}
				// If the WebSocket is CONNECTING, queue the message
				else if (targetWs.readyState === WebSocket.CONNECTING) {
					messageQueue.push(evt.data);
				}
				// Otherwise (CLOSING or CLOSED), ignore the message
			},

			// Handle client WebSocket close
			onClose: (evt: CloseEvent, wsContext: WSContext) => {
				invariant(targetWs, "targetWs not defined");

				logger().debug("client websocket closed", {
					code: evt.code,
					reason: evt.reason,
				});

				// Close target if it's either CONNECTING or OPEN
				//
				// We're only allowed to send code 1000 from the client
				if (
					targetWs.readyState === WebSocket.CONNECTING ||
					targetWs.readyState === WebSocket.OPEN
				) {
					// We can only send code 1000 from the client
					targetWs.close(1000, evt.reason || "Client closed connection");
				}
			},

			// Handle client WebSocket errors
			onError: (_evt: Event, wsContext: WSContext) => {
				invariant(targetWs, "targetWs not defined");

				logger().warn("websocket proxy received error from client");

				// Close target with specific error code for proxy errors
				//
				// We're only allowed to send code 1000 from the client
				if (
					targetWs.readyState === WebSocket.CONNECTING ||
					targetWs.readyState === WebSocket.OPEN
				) {
					targetWs.close(1000, "Error in client connection");
				}
			},
		};
	})(c, async () => {});
}
