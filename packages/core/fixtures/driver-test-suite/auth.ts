import { worker, UserError } from "@rivetkit/core";

// Basic auth worker - requires API key
export const authWorker = worker({
	state: { requests: 0 },
	onAuth: (opts) => {
		const { req, intents, params } = opts;
		const apiKey = (params as any)?.apiKey;
		if (!apiKey) {
			throw new UserError("API key required", { code: "missing_auth" });
		}
		
		if (apiKey !== "valid-api-key") {
			throw new UserError("Invalid API key", { code: "invalid_auth" });
		}
		
		return { userId: "user123", token: apiKey };
	},
	actions: {
		getRequests: (c) => {
			c.state.requests++;
			return c.state.requests;
		},
		getUserAuth: (c) => c.conn.auth,
	},
});

// Intent-specific auth worker - checks different permissions for different intents
export const intentAuthWorker = worker({
	state: { value: 0 },
	onAuth: (opts) => {
		const { req, intents, params } = opts;
		console.log('intents', intents, params);
		const role = (params as any)?.role;
		
		if (intents.has("create") && role !== "admin") {
			throw new UserError("Admin role required for create operations", { code: "insufficient_permissions" });
		}
		
		if (intents.has("action") && !["admin", "user"].includes(role || "")) {
			throw new UserError("User or admin role required for actions", { code: "insufficient_permissions" });
		}
		
		return { role, timestamp: Date.now() };
	},
	actions: {
		getValue: (c) => c.state.value,
		setValue: (c, value: number) => {
			c.state.value = value;
			return value;
		},
		getAuth: (c) => c.conn.auth,
	},
});

// Public worker - empty onAuth to allow public access
export const publicWorker = worker({
	state: { visitors: 0 },
	onAuth: () => {
		return null; // Allow public access
	},
	actions: {
		visit: (c) => {
			c.state.visitors++;
			return c.state.visitors;
		},
	},
});

// No auth worker - should fail when accessed publicly (no onAuth defined)
export const noAuthWorker = worker({
	state: { value: 42 },
	actions: {
		getValue: (c) => c.state.value,
	},
});

// Async auth worker - tests promise-based authentication
export const asyncAuthWorker = worker({
	state: { count: 0 },
	onAuth: async (opts) => {
		const { req, intents, params } = opts;
		// Simulate async auth check (e.g., database lookup)
		await new Promise(resolve => setTimeout(resolve, 10));
		
		const token = (params as any)?.token;
		if (!token) {
			throw new UserError("Token required", { code: "missing_token" });
		}
		
		// Simulate token validation
		if (token === "invalid") {
			throw new UserError("Token is invalid", { code: "invalid_token" });
		}
		
		return { userId: `user-${token}`, validated: true };
	},
	actions: {
		increment: (c) => {
			c.state.count++;
			return c.state.count;
		},
		getAuthData: (c) => c.conn.auth,
	},
});
