import {
	type ActorContext,
	actor,
	type UniversalWebSocket,
	UserError,
} from "@rivetkit/core";

// Raw WebSocket actor with authentication
export const rawWebSocketAuthActor = actor({
	state: {
		connectionCount: 0,
		messageCount: 0,
	},
	onAuth: (opts, params: { apiKey?: string }) => {
		const apiKey = params.apiKey;
		if (!apiKey) {
			throw new UserError("API key required", { code: "missing_auth" });
		}

		if (apiKey !== "valid-api-key") {
			throw new UserError("Invalid API key", { code: "invalid_auth" });
		}

		return { userId: "user123", token: apiKey };
	},
	onWebSocket(ctx, websocket) {
		ctx.state.connectionCount++;

		// Send welcome message on connect
		websocket.send(
			JSON.stringify({
				type: "welcome",
				message: "Authenticated WebSocket connection",
				connectionCount: ctx.state.connectionCount,
			}),
		);

		websocket.addEventListener("message", (event: any) => {
			ctx.state.messageCount++;
			const data = event.data;

			if (typeof data === "string") {
				try {
					const parsed = JSON.parse(data);
					if (parsed.type === "getAuth") {
						websocket.send(
							JSON.stringify({
								type: "authInfo",
								authenticated: true,
							}),
						);
					} else {
						// Echo message back
						websocket.send(
							JSON.stringify({
								type: "echo",
								original: parsed,
							}),
						);
					}
				} catch {
					websocket.send(data);
				}
			}
		});

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

// Raw WebSocket actor without onAuth - should deny access
export const rawWebSocketNoAuthActor = actor({
	state: {
		connections: 0,
	},
	onWebSocket(ctx, websocket) {
		ctx.state.connections++;
		websocket.send(
			JSON.stringify({
				type: "connected",
				connections: ctx.state.connections,
			}),
		);
	},
	actions: {
		getConnectionCount(ctx: any) {
			return ctx.state.connections;
		},
	},
});

// Raw WebSocket actor with public access
export const rawWebSocketPublicActor = actor({
	state: {
		visitors: 0,
	},
	onAuth: () => {
		return null; // Allow public access
	},
	onWebSocket(ctx, websocket) {
		ctx.state.visitors++;

		websocket.send(
			JSON.stringify({
				type: "welcome",
				message: "Public WebSocket connection",
				visitorNumber: ctx.state.visitors,
			}),
		);

		websocket.addEventListener("message", (event: any) => {
			// Echo messages
			websocket.send(event.data);
		});
	},
	actions: {
		getVisitorCount(ctx: any) {
			return ctx.state.visitors;
		},
	},
});

// Raw WebSocket with custom auth in onWebSocket
export const rawWebSocketCustomAuthActor = actor({
	state: {
		authorized: 0,
		unauthorized: 0,
	},
	onAuth: () => {
		// Allow all connections - auth will be handled in onWebSocket
		return {};
	},
	onWebSocket(ctx, websocket, opts) {
		// Check for auth token in URL or headers
		const url = new URL(opts.request.url);
		const token = url.searchParams.get("token");

		if (!token || token !== "custom-ws-token") {
			ctx.state.unauthorized++;
			websocket.send(
				JSON.stringify({
					type: "error",
					message: "Unauthorized",
				}),
			);
			websocket.close(1008, "Unauthorized");
			return;
		}

		ctx.state.authorized++;
		websocket.send(
			JSON.stringify({
				type: "authorized",
				message: "Welcome authenticated user!",
			}),
		);

		websocket.addEventListener("message", (event: any) => {
			websocket.send(
				JSON.stringify({
					type: "echo",
					data: event.data,
					authenticated: true,
				}),
			);
		});
	},
	actions: {
		getStats(ctx: any) {
			return {
				authorized: ctx.state.authorized,
				unauthorized: ctx.state.unauthorized,
			};
		},
	},
});
