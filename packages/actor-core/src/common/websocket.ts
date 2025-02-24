export async function importWebSocket(): Promise<typeof WebSocket> {
	let _WebSocket: typeof WebSocket;

	// Node.js environment
	try {
		const ws = await import("ws");
		if (!ws.WebSocket) throw "Unsupported";
		_WebSocket = ws.WebSocket as unknown as typeof WebSocket;
	} catch {
		if (typeof WebSocket !== "undefined") {
			// Browser environment
			_WebSocket = WebSocket;
		} else {
			// WS not available
			_WebSocket = class MockWebSocket {
				constructor() {
					throw new Error(
						'WebSocket support requires installing the "ws" package',
					);
				}
			} as unknown as typeof WebSocket;
		}
	}

	return _WebSocket;
}
