import { type ActorContext, actor, UserError } from "@rivetkit/core";

// Raw HTTP actor with authentication - requires API key
export const rawHttpAuthActor = actor({
	state: {
		requestCount: 0,
	},
	onAuth: (params) => {
		const apiKey = (params as any)?.apiKey;
		if (!apiKey) {
			throw new UserError("API key required", { code: "missing_auth" });
		}

		if (apiKey !== "valid-api-key") {
			throw new UserError("Invalid API key", { code: "invalid_auth" });
		}

		return { userId: "user123", token: apiKey };
	},
	onFetch(
		ctx: ActorContext<any, any, any, any, any, any, any>,
		request: Request,
	) {
		const url = new URL(request.url);
		ctx.state.requestCount++;

		// Auth info endpoint - onAuth was already called
		if (url.pathname === "/api/auth-info") {
			return new Response(
				JSON.stringify({
					message: "Authenticated request",
					requestCount: ctx.state.requestCount,
				}),
				{
					headers: { "Content-Type": "application/json" },
				},
			);
		}

		if (url.pathname === "/api/protected") {
			return new Response(
				JSON.stringify({
					message: "This is protected content",
				}),
				{
					headers: { "Content-Type": "application/json" },
				},
			);
		}

		return new Response("Not Found", { status: 404 });
	},
	actions: {
		getRequestCount(ctx: any) {
			return ctx.state.requestCount;
		},
		getAuthFromConnections(ctx: any) {
			// Get auth data from first connection if available
			const firstConn = ctx.conns.values().next().value;
			return firstConn?.auth;
		},
	},
});

// Raw HTTP actor without onAuth - should deny access
export const rawHttpNoAuthActor = actor({
	state: {
		value: 42,
	},
	onFetch(
		ctx: ActorContext<any, any, any, any, any, any, any>,
		request: Request,
	) {
		return new Response(
			JSON.stringify({
				value: ctx.state.value,
			}),
			{
				headers: { "Content-Type": "application/json" },
			},
		);
	},
	actions: {
		getValue(ctx: any) {
			return ctx.state.value;
		},
	},
});

// Raw HTTP actor with public access (empty onAuth)
export const rawHttpPublicActor = actor({
	state: {
		visitors: 0,
	},
	onAuth: () => {
		return null; // Allow public access
	},
	onFetch(
		ctx: ActorContext<any, any, any, any, any, any, any>,
		request: Request,
	) {
		ctx.state.visitors++;
		return new Response(
			JSON.stringify({
				message: "Welcome visitor!",
				count: ctx.state.visitors,
			}),
			{
				headers: { "Content-Type": "application/json" },
			},
		);
	},
	actions: {
		getVisitorCount(ctx: any) {
			return ctx.state.visitors;
		},
	},
});

// Raw HTTP actor with custom auth in onFetch (no onAuth)
export const rawHttpCustomAuthActor = actor({
	state: {
		authorized: 0,
		unauthorized: 0,
	},
	onAuth: () => {
		// Allow all connections - auth will be handled in onFetch
		return {};
	},
	onFetch(
		ctx: ActorContext<any, any, any, any, any, any, any>,
		request: Request,
	) {
		// Custom auth check in onFetch
		const authHeader = request.headers.get("Authorization");

		if (!authHeader || !authHeader.startsWith("Bearer ")) {
			ctx.state.unauthorized++;
			return new Response(JSON.stringify({ error: "Unauthorized" }), {
				status: 401,
				headers: { "Content-Type": "application/json" },
			});
		}

		const token = authHeader.substring(7);
		if (token !== "custom-token") {
			ctx.state.unauthorized++;
			return new Response(JSON.stringify({ error: "Invalid token" }), {
				status: 403,
				headers: { "Content-Type": "application/json" },
			});
		}

		ctx.state.authorized++;
		return new Response(
			JSON.stringify({
				message: "Authorized!",
				authorized: ctx.state.authorized,
			}),
			{
				headers: { "Content-Type": "application/json" },
			},
		);
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
