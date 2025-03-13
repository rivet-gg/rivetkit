import { logger } from "@/client/log";

export async function importWebSocket(): Promise<typeof WebSocket> {
	let _WebSocket: typeof WebSocket;

	if (typeof WebSocket !== "undefined") {
		// Browser environment
		_WebSocket = WebSocket;
		logger().debug("using native websocket");
	} else {
		// Node.js environment
		try {
			const ws = await import("ws");
			_WebSocket = ws.default as unknown as typeof WebSocket;
			logger().debug("using websocket from npm");
		} catch {
			// WS not available
			_WebSocket = class MockWebSocket {
				constructor() {
					throw new Error(
						'WebSocket support requires installing the "ws" peer dependency.',
					);
				}
			} as unknown as typeof WebSocket;
			logger().debug("using mock websocket");
		}
	}

	return _WebSocket;
}
