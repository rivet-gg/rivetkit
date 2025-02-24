export async function importWebSocket(): Promise<typeof WebSocket> {
	let _WebSocket: typeof WebSocket;
	
	if (typeof WebSocket !== "undefined") {
		// Browser environment
		_WebSocket = WebSocket;
	} else {
		try {
			// Node.js environment
			const ws = await import("ws");
			console.log('toimiiko tää selaimes', ws)
			_WebSocket = ws.WebSocket as unknown as typeof WebSocket;
		} catch {
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
