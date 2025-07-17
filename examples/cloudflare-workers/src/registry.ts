import { actor, setup } from "@rivetkit/actor";

export const counter = actor({
	onAuth: () => {
		// Configure auth here
	},
	state: { count: 0, connectionCount: 0, messageCount: 0 },
	actions: {
		increment: (c, x: number) => {
			c.state.count += x;
			c.broadcast("foo", 1);
			return c.state.count;
		},
	},
	onWebSocket: (ctx, websocket) => {
		// ctx.state.connectionCount = ctx.state.connectionCount + 1;

		// Send welcome message
		websocket.send(
			JSON.stringify({
				type: "welcome",
				connectionCount: ctx.state.connectionCount,
			}),
		);

		// Echo messages back
		websocket.addEventListener("message", (event: any) => {
			//ctx.state.messageCount++;

			const data = event.data;
			if (typeof data === "string") {
				try {
					const parsed = JSON.parse(data);
					if (parsed.type === "ping") {
						websocket.send(
							JSON.stringify({
								type: "pong",
								timestamp: Date.now(),
							}),
						);
					} else if (parsed.type === "getStats") {
						websocket.send(
							JSON.stringify({
								type: "stats",
								connectionCount: ctx.state.connectionCount,
								messageCount: ctx.state.messageCount,
							}),
						);
					} else if (parsed.type === "getAuthData") {
						// Auth data is not directly available in raw WebSocket handler
						// Send a message indicating this limitation
						websocket.send(
							JSON.stringify({
								type: "authData",
								authData: null,
								message: "Auth data not available in raw WebSocket handler",
							}),
						);
					} else {
						// Echo back
						websocket.send(data);
					}
				} catch {
					// If not JSON, just echo it back
					websocket.send(data);
				}
			} else {
				// Echo binary data
				websocket.send(data);
			}
		});

		// Handle close
		websocket.addEventListener("close", () => {
			// ctx.state.connectionCount = ctx.state.connectionCount - 1;
		});
	},
});

export const registry = setup({
	use: { counter },
});
