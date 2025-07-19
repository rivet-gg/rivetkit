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
	onWebSocket(ctx, websocket, opts) {
		ctx.state.connectionCount = ctx.state.connectionCount + 1;
		console.log(`[ACTOR] New connection, count: ${ctx.state.connectionCount}`);

		// Send welcome message
		websocket.send(
			JSON.stringify({
				type: "welcome",
				connectionCount: ctx.state.connectionCount,
			}),
		);
		console.log("[ACTOR] Sent welcome message");

		// Echo messages back
		websocket.addEventListener("message", (event: any) => {
			ctx.state.messageCount = ctx.state.messageCount + 1;
			console.log(
				`[ACTOR] Message received, total count: ${ctx.state.messageCount}, data:`,
				event.data,
			);

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
						console.log(
							`[ACTOR] Sending stats - connections: ${ctx.state.connectionCount}, messages: ${ctx.state.messageCount}`,
						);
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
					} else if (parsed.type === "getRequestInfo") {
						// Send back the request URL info
						websocket.send(
							JSON.stringify({
								type: "requestInfo",
								url: opts.request.url,
								pathname: new URL(opts.request.url).pathname,
								search: new URL(opts.request.url).search,
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
			ctx.state.connectionCount = ctx.state.connectionCount - 1;
			console.log(
				`[ACTOR] Connection closed, count: ${ctx.state.connectionCount}`,
			);
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
	onWebSocket(ctx, websocket, opts) {
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
