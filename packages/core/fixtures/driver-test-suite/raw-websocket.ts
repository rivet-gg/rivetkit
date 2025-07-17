import {
	type ActorContext,
	actor,
	type UniversalWebSocket,
} from "@rivetkit/core";

export const rawWebSocketActor = actor({
	state: {
		connectionCount: 0,
		messageCount: 0,
	},
	onAuth(opts) {
		// Allow all connections and pass through connection params
		return { connParams: opts.params };
	},
	onWebSocket(
		ctx: ActorContext<any, any, any, any, any, any, any>,
		websocket: UniversalWebSocket,
		request: Request,
	) {
		ctx.state.connectionCount++;

		// Send welcome message
		websocket.send(
			JSON.stringify({
				type: "welcome",
				connectionCount: ctx.state.connectionCount,
			}),
		);

		// Echo messages back
		websocket.addEventListener("message", (event: any) => {
			ctx.state.messageCount++;

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
			ctx.state.connectionCount--;
		});
	},
	actions: {
		getStats(ctx: any) {
			return {
				connectionCount: ctx.state.connectionCount,
				messageCount: ctx.state.messageCount,
			};
		},
	},
});

export const rawWebSocketBinaryActor = actor({
	onAuth() {
		// Allow all connections
		return {};
	},
	onWebSocket(
		ctx: ActorContext<any, any, any, any, any, any, any>,
		websocket: UniversalWebSocket,
		request: Request,
	) {
		// Handle binary data
		websocket.addEventListener("message", (event: any) => {
			const data = event.data;
			if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
				// Reverse the bytes and send back
				const bytes = new Uint8Array(data);
				const reversed = new Uint8Array(bytes.length);
				for (let i = 0; i < bytes.length; i++) {
					reversed[i] = bytes[bytes.length - 1 - i];
				}
				websocket.send(reversed);
			}
		});
	},
	actions: {},
});
