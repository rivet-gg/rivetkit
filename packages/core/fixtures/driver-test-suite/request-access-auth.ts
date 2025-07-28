import { actor } from "@rivetkit/core";

/**
 * Test fixture to verify request object access in onAuth hook
 * onAuth runs on the HTTP server, not in the actor, so we test it separately
 */
export const requestAccessAuthActor = actor({
	onAuth: ({
		req,
		intents,
		params,
	}: {
		req: Request;
		intents: Set<string>;
		params?: { trackRequest?: boolean };
	}) => {
		if (params?.trackRequest) {
			// Extract request info and return it as auth data
			const headers: Record<string, string> = {};
			req.headers.forEach((value, key) => {
				headers[key] = value;
			});

			return {
				hasRequest: true,
				requestUrl: req.url,
				requestMethod: req.method,
				requestHeaders: headers,
				intents: Array.from(intents),
			};
		}

		// Return empty auth data when not tracking
		return {};
	},
	state: {
		authData: null as any,
	},
	onConnect: (c, conn) => {
		// Store auth data in state so we can retrieve it
		c.state.authData = conn.auth;
	},
	actions: {
		getAuthRequestInfo: (c) => {
			// Return the stored auth data or a default object
			const authData = c.state.authData || {
				hasRequest: false,
				requestUrl: null,
				requestMethod: null,
				requestHeaders: {},
				intents: [],
			};
			return authData;
		},
	},
});
