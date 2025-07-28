import { actor } from "@rivetkit/core";

/**
 * Test fixture to verify request object access in all lifecycle hooks
 */
export const requestAccessActor = actor({
	onAuth: () => {}, // Allow unauthenticated connections
	state: {
		// Track request info from different hooks
		onBeforeConnectRequest: {
			hasRequest: false,
			requestUrl: null as string | null,
			requestMethod: null as string | null,
			requestHeaders: {} as Record<string, string>,
		},
		createConnStateRequest: {
			hasRequest: false,
			requestUrl: null as string | null,
			requestMethod: null as string | null,
			requestHeaders: {} as Record<string, string>,
		},
		onFetchRequest: {
			hasRequest: false,
			requestUrl: null as string | null,
			requestMethod: null as string | null,
			requestHeaders: {} as Record<string, string>,
		},
		onWebSocketRequest: {
			hasRequest: false,
			requestUrl: null as string | null,
			requestMethod: null as string | null,
			requestHeaders: {} as Record<string, string>,
		},
	},
	createConnState: (
		c,
		{
			params,
			request,
		}: { params?: { trackRequest?: boolean }; request?: Request },
	) => {
		if (params?.trackRequest && request) {
			c.state.createConnStateRequest.hasRequest = true;
			c.state.createConnStateRequest.requestUrl = request.url;
			c.state.createConnStateRequest.requestMethod = request.method;

			// Store select headers
			const headers: Record<string, string> = {};
			request.headers.forEach((value, key) => {
				headers[key] = value;
			});
			c.state.createConnStateRequest.requestHeaders = headers;
		}

		return {
			trackRequest: params?.trackRequest || false,
		};
	},
	onBeforeConnect: (c, { request, params }) => {
		if (params?.trackRequest) {
			if (request) {
				c.state.onBeforeConnectRequest.hasRequest = true;
				c.state.onBeforeConnectRequest.requestUrl = request.url;
				c.state.onBeforeConnectRequest.requestMethod = request.method;

				// Store select headers
				const headers: Record<string, string> = {};
				request.headers.forEach((value, key) => {
					headers[key] = value;
				});
				c.state.onBeforeConnectRequest.requestHeaders = headers;
			} else {
				// Track that we tried but request was not available
				c.state.onBeforeConnectRequest.hasRequest = false;
			}
		}
	},
	onFetch: (c, request) => {
		// Store request info
		c.state.onFetchRequest.hasRequest = true;
		c.state.onFetchRequest.requestUrl = request.url;
		c.state.onFetchRequest.requestMethod = request.method;

		// Store select headers
		const headers: Record<string, string> = {};
		request.headers.forEach((value, key) => {
			headers[key] = value;
		});
		c.state.onFetchRequest.requestHeaders = headers;

		// Return response with request info
		return new Response(
			JSON.stringify({
				hasRequest: true,
				requestUrl: request.url,
				requestMethod: request.method,
				requestHeaders: headers,
			}),
			{
				status: 200,
				headers: { "Content-Type": "application/json" },
			},
		);
	},
	onWebSocket: (c, websocket, { request }) => {
		// Store request info
		c.state.onWebSocketRequest.hasRequest = true;
		c.state.onWebSocketRequest.requestUrl = request.url;
		c.state.onWebSocketRequest.requestMethod = request.method;

		// Store select headers
		const headers: Record<string, string> = {};
		request.headers.forEach((value, key) => {
			headers[key] = value;
		});
		c.state.onWebSocketRequest.requestHeaders = headers;

		// Send request info on connection
		websocket.send(
			JSON.stringify({
				hasRequest: true,
				requestUrl: request.url,
				requestMethod: request.method,
				requestHeaders: headers,
			}),
		);

		// Echo messages back
		websocket.addEventListener("message", (event) => {
			websocket.send(event.data);
		});
	},
	actions: {
		getRequestInfo: (c) => {
			return {
				onBeforeConnect: c.state.onBeforeConnectRequest,
				createConnState: c.state.createConnStateRequest,
				onFetch: c.state.onFetchRequest,
				onWebSocket: c.state.onWebSocketRequest,
			};
		},
	},
});
