import { Hono, type Context as HonoContext } from "hono";
import { cors } from "hono/cors";
import { logger } from "./log";
import { handleRouteError, handleRouteNotFound } from "@/common/router";
import type { DriverConfig } from "@/driver-helpers/config";
import type { AppConfig } from "@/app/config";
import {
	createManagerInspectorRouter,
	type ManagerInspectorConnHandler,
} from "@/inspector/manager";
import type { UpgradeWebSocket } from "hono/ws";
import { type SSEStreamingApi, streamSSE } from "hono/streaming";
import { ConnectQuerySchema } from "./protocol/query";
import { ActorsRequestSchema } from "./protocol/mod";
import * as errors from "@/actor/errors";
import type { ActorQuery } from "./protocol/query";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { EventSource } from "eventsource";

type ManagerRouterHandler = {
	onConnectInspector?: ManagerInspectorConnHandler;
	upgradeWebSocket?: UpgradeWebSocket;
};

export function createManagerRouter(
	appConfig: AppConfig,
	driverConfig: DriverConfig,
	handler: ManagerRouterHandler,
) {
	if (!driverConfig.drivers?.manager) {
		// FIXME move to config schema
		throw new Error("config.drivers.manager is not defined.");
	}
	const driver = driverConfig.drivers.manager;
	const app = new Hono();

	// Apply CORS middleware if configured
	if (appConfig.cors) {
		app.use("*", async (c, next) => {
			const path = c.req.path;

			// Don't apply to WebSocket routes
			if (path === "/actor/connect/websocket") {
				return next();
			}

			return cors(appConfig.cors)(c, next);
		});
	}

	app.get("/", (c) => {
		return c.text(
			"This is an ActorCore server.\n\nLearn more at https://actorcore.org",
		);
	});

	app.get("/health", (c) => {
		return c.text("ok");
	});

	// Get the Base URL to build endpoints 
	function getBaseUrl(c: HonoContext): string {
		// Extract host from request headers since c.req.url might not include the proper host
		const host = c.req.header("Host") || "localhost";
		const protocol = c.req.header("X-Forwarded-Proto") || "http";
		
		// Construct URL with hostname from headers
		const baseUrl = `${protocol}://${host}`;
		
		// Add base path if configured
		let finalUrl = baseUrl;
		if (appConfig.basePath) {
			const basePath = appConfig.basePath;
			if (!basePath.startsWith("/"))
				throw new Error("config.basePath must start with /");
			if (basePath.endsWith("/"))
				throw new Error("config.basePath must not end with /");
			finalUrl += basePath;
		}
		
		logger().debug("=== Base URL constructed from headers ===", { 
			host: host,
			protocol: protocol,
			baseUrl: baseUrl,
			finalUrl: finalUrl,
			forwarded: c.req.header("X-Forwarded-For"),
			originalUrl: c.req.url,
		});
		
		return finalUrl;
	}

	// Helper function to get actor endpoint
	async function getActorEndpoint(c: HonoContext, query: ActorQuery): Promise<string> {
		const baseUrl = getBaseUrl(c);
		
		let actorOutput: { endpoint: string };
		if ("getForId" in query) {
			const output = await driver.getForId({
				c,
				baseUrl: baseUrl,
				actorId: query.getForId.actorId,
			});
			if (!output)
				throw new errors.ActorNotFound(query.getForId.actorId);
			actorOutput = output;
		} else if ("getForKey" in query) {
			const existingActor = await driver.getWithKey({
				c,
				baseUrl: baseUrl,
				name: query.getForKey.name,
				key: query.getForKey.key,
			});
			if (!existingActor) {
				throw new errors.ActorNotFound(`${query.getForKey.name}:${JSON.stringify(query.getForKey.key)}`);
			}
			actorOutput = existingActor;
		} else if ("getOrCreateForKey" in query) {
			const existingActor = await driver.getWithKey({
				c,
				baseUrl: baseUrl,
				name: query.getOrCreateForKey.name,
				key: query.getOrCreateForKey.key,
			});
			if (existingActor) {
				// Actor exists
				actorOutput = existingActor;
			} else {
				// Create if needed
				actorOutput = await driver.createActor({
					c,
					baseUrl: baseUrl,
					name: query.getOrCreateForKey.name,
					key: query.getOrCreateForKey.key,
					region: query.getOrCreateForKey.region,
				});
			}
		} else if ("create" in query) {
			actorOutput = await driver.createActor({
				c,
				baseUrl: baseUrl,
				name: query.create.name,
				key: query.create.key,
				region: query.create.region,
			});
		} else {
			throw new errors.InvalidQueryFormat("Invalid query format");
		}
		
		return actorOutput.endpoint;
	}

	// Original actor lookup endpoint
	app.post("/manager/actors", async (c: HonoContext) => {
		try {
			// Parse the request body
			const body = await c.req.json();
			const result = ActorsRequestSchema.safeParse(body);
			
			if (!result.success) {
				logger().error("Invalid actor request format", { error: result.error });
				throw new errors.InvalidQueryFormat(result.error);
			}
			
			const { query } = result.data;
			logger().debug("query", { query });

			// Get the actor endpoint
			const endpoint = await getActorEndpoint(c, query);

			return c.json({
				endpoint: endpoint,
				supportedTransports: ["websocket", "sse"],
			});
		} catch (error) {
			logger().error("Error in /manager/actors endpoint", { error });
			
			// Use appropriate error if it's not already an ActorError
			if (!(error instanceof errors.ActorError)) {
				error = new errors.ProxyError("actor lookup", error);
			}
			
			throw error;
		}
	});

	// Proxy WebSocket connection to actor
	if (handler.upgradeWebSocket) {
		app.get(
			"/actor/connect/websocket",
			handler.upgradeWebSocket(async (c) => {
				try {
					// Get query parameters
					const queryParam = c.req.query("query");
					const encodingParam = c.req.query("encoding");
					const paramsParam = c.req.query("params");
					
					const missingParams: string[] = [];
					if (!queryParam) missingParams.push("query");
					if (!encodingParam) missingParams.push("encoding");
					
					if (missingParams.length > 0) {
						logger().error("Missing required parameters", { 
							query: !!queryParam,
							encoding: !!encodingParam
						});
						throw new errors.MissingRequiredParameters(missingParams);
					}
					
					// Parse the query JSON
					let parsedQuery: ActorQuery;
					try {
						// We know queryParam is defined because we checked above
						parsedQuery = JSON.parse(queryParam as string);
					} catch (error) {
						logger().error("Invalid query JSON", { error });
						throw new errors.InvalidQueryJSON(error);
					}
					
					// Validate using the schema
					const params = ConnectQuerySchema.safeParse({
						query: parsedQuery,
						encoding: encodingParam,
						params: paramsParam
					});

					if (!params.success) {
						logger().error("Invalid connection parameters", { 
							error: params.error 
						});
						throw new errors.InvalidQueryFormat(params.error);
					}

					const query = params.data.query;
					logger().debug("websocket connection query", { query });

					// Get the actor endpoint
					const actorEndpoint = await getActorEndpoint(c, query);
					logger().debug("actor endpoint", { actorEndpoint });

					// Build the actor connection URL
					let actorUrl = `${actorEndpoint}/connect/websocket?encoding=${params.data.encoding}`;
					if (params.data.params) {
						actorUrl += `&params=${params.data.params}`;
					}
					
					// Convert to WebSocket URL
					actorUrl = actorUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
					logger().debug("connecting to websocket", { url: actorUrl });

					// Connect to the actor's WebSocket endpoint
					const actorWs = new WebSocket(actorUrl);
					actorWs.binaryType = "arraybuffer";

					// Return WebSocket handler that pipes between client and actor
					return {
						onOpen: async (_evt, clientWs) => {
							logger().debug("client websocket open");
							
							// Wait for the actor WebSocket to open
							await new Promise<void>((resolve) => {
								actorWs.onopen = () => {
									logger().debug("actor websocket open");
									resolve();
								};
							});

							// Set up message forwarding from actor to client
							actorWs.onmessage = (actorEvt) => {
								clientWs.send(actorEvt.data);
							};

							// Set up close event forwarding
							actorWs.onclose = (closeEvt) => {
								logger().debug("actor websocket closed");
								// Ensure we use a valid close code (must be between 1000-4999)
								const code = (closeEvt.code && closeEvt.code >= 1000 && closeEvt.code <= 4999) 
									? closeEvt.code 
									: 1000; // Use normal closure as default
								clientWs.close(code, closeEvt.reason);
							};

							// Set up error handling
							actorWs.onerror = (errorEvt) => {
								logger().error("actor websocket error", { error: errorEvt });
								clientWs.close(1011, "Error in actor connection");
							};
						},
						onMessage: async (evt, clientWs) => {
							// Forward messages from client to actor
							if (actorWs.readyState === WebSocket.OPEN) {
								actorWs.send(evt.data);
							}
						},
						onClose: async (evt) => {
							logger().debug("client websocket closed");
							// Close actor WebSocket if it's still open
							if (actorWs.readyState === WebSocket.OPEN || 
								actorWs.readyState === WebSocket.CONNECTING) {
								// Ensure we use a valid close code (must be between 1000-4999)
								const code = (evt.code && evt.code >= 1000 && evt.code <= 4999) 
									? evt.code 
									: 1000; // Use normal closure as default
								actorWs.close(code, evt.reason);
							}
						},
						onError: async (error) => {
							logger().error("client websocket error", { error });
							// Close actor WebSocket if it's still open
							if (actorWs.readyState === WebSocket.OPEN || 
								actorWs.readyState === WebSocket.CONNECTING) {
								// 1011 is a valid code for server error
								actorWs.close(1011, "Error in client connection");
							}
						}
					};
				} catch (error) {
					logger().error("Error setting up WebSocket proxy", { error });
					
					// Use ProxyError if it's not already an ActorError
					if (!(error instanceof errors.ActorError)) {
						error = new errors.ProxyError("WebSocket connection", error);
					}
					
					throw error;
				}
			}),
		);
	}

	// Proxy SSE connection to actor
	app.get("/actor/connect/sse", async (c) => {
		try {
			// Get query parameters
			const queryParam = c.req.query("query");
			const encodingParam = c.req.query("encoding");
			const paramsParam = c.req.query("params");
			
			const missingParams: string[] = [];
			if (!queryParam) missingParams.push("query");
			if (!encodingParam) missingParams.push("encoding");
			
			if (missingParams.length > 0) {
				logger().error("Missing required parameters", { 
					query: !!queryParam,
					encoding: !!encodingParam
				});
				throw new errors.MissingRequiredParameters(missingParams);
			}
			
			// Parse the query JSON
			let parsedQuery: ActorQuery;
			try {
				// We know queryParam is defined because we checked above
				parsedQuery = JSON.parse(queryParam as string);
			} catch (error) {
				logger().error("Invalid query JSON", { error });
				throw new errors.InvalidQueryJSON(error);
			}
			
			// Validate using the schema
			const params = ConnectQuerySchema.safeParse({
				query: parsedQuery,
				encoding: encodingParam,
				params: paramsParam
			});

			if (!params.success) {
				logger().error("Invalid connection parameters", { 
					error: params.error 
				});
				throw new errors.InvalidQueryFormat(params.error);
			}

			const query = params.data.query;
			logger().debug("sse connection query", { query });

			// Get the actor endpoint
			const actorEndpoint = await getActorEndpoint(c, query);
			logger().debug("actor endpoint", { actorEndpoint });

			// Build the actor connection URL
			let actorUrl = `${actorEndpoint}/connect/sse?encoding=${params.data.encoding}`;
			if (params.data.params) {
				actorUrl += `&params=${params.data.params}`;
			}
			
			return streamSSE(c, async (stream) => {
				logger().debug("client sse stream open");
				
				// Create EventSource to connect to the actor
				const actorSse = new EventSource(actorUrl);
				
				// Forward messages from actor to client
				actorSse.onmessage = (evt: MessageEvent) => {
					stream.write(String(evt.data));
				};
				
				// Handle errors
				actorSse.onerror = (evt: Event) => {
					logger().error("actor sse error", { error: evt });
					stream.close();
				};
				
				// Set up cleanup when client disconnects
				stream.onAbort(() => {
					logger().debug("client sse stream aborted");
					actorSse.close();
				});
				
				// Keep the stream alive until aborted
				await new Promise<void>(() => {});
			});
		} catch (error) {
			logger().error("Error setting up SSE proxy", { error });
			
			// Use ProxyError if it's not already an ActorError
			if (!(error instanceof errors.ActorError)) {
				error = new errors.ProxyError("SSE connection", error);
			}
			
			throw error;
		}
	});

	// Proxy RPC calls to actor
	app.post("/actor/rpc/:rpc", async (c) => {
		try {
			const rpcName = c.req.param("rpc");
			logger().debug("=== RPC PROXY: Call received ===", { rpcName });
			
			// Get query parameters for actor lookup
			const queryParam = c.req.query("query");
			if (!queryParam) {
				logger().error("=== RPC PROXY: Missing query parameter ===");
				throw new errors.MissingRequiredParameters(["query"]);
			}
			
			// Parse the query JSON and validate with schema
			let parsedQuery: ActorQuery;
			try {
				parsedQuery = JSON.parse(queryParam as string);
				logger().debug("=== RPC PROXY: Parsed query ===", { query: parsedQuery });
			} catch (error) {
				logger().error("=== RPC PROXY: Invalid query JSON ===", { error, queryParam });
				throw new errors.InvalidQueryJSON(error);
			}
			
			// Get the actor endpoint
			const actorEndpoint = await getActorEndpoint(c, parsedQuery);
			logger().debug("=== RPC PROXY: Actor endpoint ===", { actorEndpoint, rpcName });
			
			// Forward the RPC call to the actor
			const rpcUrl = `${actorEndpoint}/rpc/${rpcName}`;
			logger().debug("=== RPC PROXY: Forwarding to ===", { url: rpcUrl });
			
			// Get request body text to forward
			const bodyText = await c.req.text();
			logger().debug("=== RPC PROXY: Request body ===", { body: bodyText });
			
			try {
				// Forward the request
				const response = await fetch(rpcUrl, {
					method: "POST",
					headers: {
						"Content-Type": c.req.header("Content-Type") || "application/json"
					},
					body: bodyText
				});
				
				// Log response status
				logger().debug("=== RPC PROXY: Response received ===", { 
					status: response.status, 
					ok: response.ok,
					headers: Object.fromEntries([...response.headers])
				});
				
				if (!response.ok) {
					// Clone response to avoid consuming body multiple times
					const errorResponse = response.clone();
					const errorText = await errorResponse.text();
					logger().error("=== RPC PROXY: Error from actor ===", { 
						status: response.status, 
						error: errorText 
					});
					
					// Try to parse error as JSON
					try {
						const errorJson = JSON.parse(errorText);
						return c.json(errorJson, { 
							status: response.status as ContentfulStatusCode 
						});
					} catch {
						// If not valid JSON, return as is
						return c.text(errorText, { 
							status: response.status as ContentfulStatusCode 
						});
					}
				}
				
				// Clone response to log it without consuming the body
				const responseClone = response.clone();
				const responseTextForLog = await responseClone.text();
				logger().debug("=== RPC PROXY: Response body ===", { body: responseTextForLog });
				
				// Get response as JSON for proxying
				const responseJson = await response.json();
				logger().debug("=== RPC PROXY: Response parsed ===", { responseJson });
				
				// Return the actor's response
				return c.json(responseJson, { 
					status: response.status as ContentfulStatusCode
				});
			} catch (fetchError) {
				logger().error("=== RPC PROXY: Fetch error ===", { 
					error: fetchError,
					url: rpcUrl
				});
				throw new errors.ProxyError("Fetch error to actor", fetchError);
			}
		} catch (error) {
			logger().error("=== RPC PROXY: Error in handler ===", { error });
			
			// Use ProxyError if it's not already an ActorError
			if (!(error instanceof errors.ActorError)) {
				error = new errors.ProxyError("RPC call", error);
			}
			
			throw error;
		}
	});

	// Proxy connection messages to actor
	app.post("/actor/connections/:conn/message", async (c) => {
		try {
			const connId = c.req.param("conn");
			const connToken = c.req.query("connectionToken");
			const encoding = c.req.query("encoding");
			
			// Get query parameters for actor lookup
			const queryParam = c.req.query("query");
			if (!queryParam) {
				throw new errors.MissingRequiredParameters(["query"]);
			}
			
			// Check other required parameters
			const missingParams: string[] = [];
			if (!connToken) missingParams.push("connectionToken");
			if (!encoding) missingParams.push("encoding");
			
			if (missingParams.length > 0) {
				throw new errors.MissingRequiredParameters(missingParams);
			}
			
			// Parse the query JSON and validate with schema
			let parsedQuery: ActorQuery;
			try {
				parsedQuery = JSON.parse(queryParam as string);
			} catch (error) {
				logger().error("Invalid query JSON", { error });
				throw new errors.InvalidQueryJSON(error);
			}
			
			// Get the actor endpoint
			const actorEndpoint = await getActorEndpoint(c, parsedQuery);
			logger().debug("actor endpoint for connection", { actorEndpoint });
			
			// Forward the message to the actor
			const messageUrl = `${actorEndpoint}/connections/${connId}/message?connectionToken=${connToken}&encoding=${encoding}`;
			const response = await fetch(messageUrl, {
				method: "POST",
				headers: {
					"Content-Type": c.req.header("Content-Type") || "application/json"
				},
				body: await c.req.text()
			});
			
			// Return the actor's response
			return c.json(await response.json(), { 
				status: response.status as ContentfulStatusCode 
			});
		} catch (error) {
			logger().error("Error proxying connection message", { error });
			
			// Use ProxyError if it's not already an ActorError
			if (!(error instanceof errors.ActorError)) {
				error = new errors.ProxyError("connection message", error);
			}
			
			throw error;
		}
	});

	if (appConfig.inspector.enabled) {
		app.route(
			"/manager/inspect",
			createManagerInspectorRouter(
				handler.upgradeWebSocket,
				handler.onConnectInspector,
				appConfig.inspector,
			),
		);
	}

	app.notFound(handleRouteNotFound);
	app.onError(handleRouteError);

	return app;
}
