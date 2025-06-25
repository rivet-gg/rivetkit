// import {
// 	type DurableObjectConstructor,
// 	type ActorHandlerInterface,
// 	createActorDurableObject,
// } from  "./actor-handler-do";
// import { ConfigSchema, type InputConfig } from "./config";
// import { assertUnreachable } from "@rivetkit/core/utils";
// import {
// 	HEADER_AUTH_DATA,
// 	HEADER_CONN_PARAMS,
// 	HEADER_ENCODING,
// 	HEADER_EXPOSE_INTERNAL_ERROR,
// } from "@rivetkit/core/driver-helpers";
// import type { Hono } from "hono";
// import { PartitionTopologyManager } from "@rivetkit/core/topologies/partition";
// import { logger } from "./log";
// import { CloudflareActorsManagerDriver } from "./manager-driver";
// import { Encoding, Registry, RunConfig } from "@rivetkit/core";
// import { upgradeWebSocket } from "./websocket";
// import invariant from "invariant";
// import { AsyncLocalStorage } from "node:async_hooks";
// import { InternalError } from "@rivetkit/core/errors";
//
// /** Cloudflare Workers env */
// export interface Bindings {
// 	ACTOR_KV: KVNamespace;
// 	ACTOR_DO: DurableObjectNamespace<ActorHandlerInterface>;
// }
//
// /**
//  * Stores the env for the current request. Required since some contexts like the inline client driver does not have access to the Hono context.
//  *
//  * Use getCloudflareAmbientEnv unless using CF_AMBIENT_ENV.run.
//  */
// export const CF_AMBIENT_ENV = new AsyncLocalStorage<Bindings>();
//
// const STANDARD_WEBSOCKET_HEADERS = [
// 	"connection",
// 	"upgrade",
// 	"sec-websocket-key",
// 	"sec-websocket-version",
// 	"sec-websocket-protocol",
// 	"sec-websocket-extensions",
// ];
//
// export function getCloudflareAmbientEnv(): Bindings {
// 	const env = CF_AMBIENT_ENV.getStore();
// 	invariant(env, "missing CF_AMBIENT_ENV");
// 	return env;
// }
//
// export function createHandler(
// 	registry: Registry<any>,
// 	inputConfig?: InputConfig,
// ): {
// 	handler: ExportedHandler<Bindings>;
// 	ActorHandler: DurableObjectConstructor;
// } {
// 	// Create router
// 	const { router, ActorHandler } = createRouter(registry, inputConfig);
//
// 	// Create Cloudflare handler
// 	const handler = {
// 		fetch: (request, env, ctx) => {
// 			return CF_AMBIENT_ENV.run(env, () => router.fetch(request, env, ctx));
// 		},
// 	} satisfies ExportedHandler<Bindings>;
//
// 	return { handler, ActorHandler };
// }
//
// export function createRouter(
// 	registry: Registry<any>,
// 	inputConfig?: InputConfig,
// ): {
// 	router: Hono<{ Bindings: Bindings }>;
// 	ActorHandler: DurableObjectConstructor;
// } {
// 	const config = ConfigSchema.parse(inputConfig);
// 	const runConfig = {
// 		driver: {
// 			topology: "partition",
// 			manager: new CloudflareActorsManagerDriver(),
// 			// HACK: We can't build the actor driver until we're inside the Druable Object
// 			actor: undefined as any,
// 		},
// 		getUpgradeWebSocket: () => upgradeWebSocket,
// 		...config,
// 	} satisfies RunConfig;
//
// 	// Create Durable Object
// 	const ActorHandler = createActorDurableObject(registry, runConfig);
//
// 	const managerTopology = new PartitionTopologyManager(
// 		registry.config,
// 		runConfig,
// 		{
// 			sendRequest: async (actorId, actorRequest): Promise<Response> => {
// 				const env = getCloudflareAmbientEnv();
//
// 				logger().debug("sending request to durable object", {
// 					actorId,
// 					method: actorRequest.method,
// 					url: actorRequest.url,
// 				});
//
// 				const id = env.ACTOR_DO.idFromString(actorId);
// 				const stub = env.ACTOR_DO.get(id);
//
// 				return await stub.fetch(actorRequest);
// 			},
//
// 			openWebSocket: async (
// 				actorId,
// 				encodingKind: Encoding,
// 				params: unknown,
// 			): Promise<WebSocket> => {
// 				const env = getCloudflareAmbientEnv();
//
// 				logger().debug("opening websocket to durable object", { actorId });
//
// 				// Make a fetch request to the Durable Object with WebSocket upgrade
// 				const id = env.ACTOR_DO.idFromString(actorId);
// 				const stub = env.ACTOR_DO.get(id);
//
// 				const headers: Record<string, string> = {
// 					Upgrade: "websocket",
// 					Connection: "Upgrade",
// 					[HEADER_EXPOSE_INTERNAL_ERROR]: "true",
// 					[HEADER_ENCODING]: encodingKind,
// 				};
// 				if (params) {
// 					headers[HEADER_CONN_PARAMS] = JSON.stringify(params);
// 				}
// 				// HACK: See packages/platforms/cloudflare-workers/src/websocket.ts
// 				headers["sec-websocket-protocol"] = "rivetkit";
//
// 				const response = await stub.fetch("http://actor/connect/websocket", {
// 					headers,
// 				});
// 				const webSocket = response.webSocket;
//
// 				if (!webSocket) {
// 					throw new InternalError(
// 						"missing websocket connection in response from DO",
// 					);
// 				}
//
// 				logger().debug("durable object websocket connection open", {
// 					actorId,
// 				});
//
// 				webSocket.accept();
//
// 				// TODO: Is this still needed?
// 				// HACK: Cloudflare does not call onopen automatically, so we need
// 				// to call this on the next tick
// 				setTimeout(() => {
// 					(webSocket as any).onopen?.(new Event("open"));
// 				}, 0);
//
// 				return webSocket as unknown as WebSocket;
// 			},
//
// 			proxyRequest: async (c, actorRequest, actorId): Promise<Response> => {
// 				logger().debug("forwarding request to durable object", {
// 					actorId,
// 					method: actorRequest.method,
// 					url: actorRequest.url,
// 				});
//
// 				const id = c.env.ACTOR_DO.idFromString(actorId);
// 				const stub = c.env.ACTOR_DO.get(id);
//
// 				return await stub.fetch(actorRequest);
// 			},
// 			proxyWebSocket: async (c, path, actorId, encoding, params, authData) => {
// 				logger().debug("forwarding websocket to durable object", {
// 					actorId,
// 					path,
// 				});
//
// 				// Validate upgrade
// 				const upgradeHeader = c.req.header("Upgrade");
// 				if (!upgradeHeader || upgradeHeader !== "websocket") {
// 					return new Response("Expected Upgrade: websocket", {
// 						status: 426,
// 					});
// 				}
//
// 				// TODO: strip headers
// 				const newUrl = new URL(`http://actor${path}`);
// 				const actorRequest = new Request(newUrl, c.req.raw);
//
// 				// Always build fresh request to prevent forwarding unwanted headers
// 				// HACK: Since we can't build a new request, we need to remove
// 				// non-standard headers manually
// 				const headerKeys: string[] = [];
// 				actorRequest.headers.forEach((v, k) => headerKeys.push(k));
// 				for (const k of headerKeys) {
// 					if (!STANDARD_WEBSOCKET_HEADERS.includes(k)) {
// 						actorRequest.headers.delete(k);
// 					}
// 				}
//
// 				// Add RivetKit headers
// 				actorRequest.headers.set(HEADER_EXPOSE_INTERNAL_ERROR, "true");
// 				actorRequest.headers.set(HEADER_ENCODING, encoding);
// 				if (params) {
// 					actorRequest.headers.set(HEADER_CONN_PARAMS, JSON.stringify(params));
// 				}
// 				if (authData) {
// 					actorRequest.headers.set(HEADER_AUTH_DATA, JSON.stringify(authData));
// 				}
//
// 				const id = c.env.ACTOR_DO.idFromString(actorId);
// 				const stub = c.env.ACTOR_DO.get(id);
//
// 				return await stub.fetch(actorRequest);
// 			},
// 		},
// 	);
//
// 	// Force the router to have access to the Cloudflare bindings
// 	const router = managerTopology.router as unknown as Hono<{
// 		Bindings: Bindings;
// 	}>;
//
// 	return { router, ActorHandler };
// }
