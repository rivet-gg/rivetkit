import {
	type DurableObjectConstructor,
	type WorkerHandlerInterface,
	createWorkerDurableObject,
} from "./worker-handler-do";
import { ConfigSchema, type InputConfig } from "./config";
import { assertUnreachable } from "@rivetkit/core/utils";
import {
	HEADER_AUTH_DATA,
	HEADER_CONN_PARAMS,
	HEADER_ENCODING,
	HEADER_EXPOSE_INTERNAL_ERROR,
} from "@rivetkit/core/driver-helpers";
import type { Hono } from "hono";
import { PartitionTopologyManager } from "@rivetkit/core/topologies/partition";
import { logger } from "./log";
import { CloudflareWorkersManagerDriver } from "./manager-driver";
import { Encoding, Registry, RunConfig } from "@rivetkit/core";
import { upgradeWebSocket } from "./websocket";
import invariant from "invariant";
import { AsyncLocalStorage } from "node:async_hooks";
import { InternalError } from "@rivetkit/core/errors";

/** Cloudflare Workers env */
export interface Bindings {
	WORKER_KV: KVNamespace;
	WORKER_DO: DurableObjectNamespace<WorkerHandlerInterface>;
}

/**
 * Stores the env for the current request. Required since some contexts like the inline client driver does not have access to the Hono context.
 *
 * Use getCloudflareAmbientEnv unless using CF_AMBIENT_ENV.run.
 */
export const CF_AMBIENT_ENV = new AsyncLocalStorage<Bindings>();

const STANDARD_WEBSOCKET_HEADERS = [
	"connection",
	"upgrade",
	"sec-websocket-key",
	"sec-websocket-version",
	"sec-websocket-protocol",
	"sec-websocket-extensions",
];

export function getCloudflareAmbientEnv(): Bindings {
	const env = CF_AMBIENT_ENV.getStore();
	invariant(env, "missing CF_AMBIENT_ENV");
	return env;
}

export function createHandler(
	registry: Registry<any>,
	inputConfig?: InputConfig,
): {
	handler: ExportedHandler<Bindings>;
	WorkerHandler: DurableObjectConstructor;
} {
	// Create router
	const { router, WorkerHandler } = createRouter(registry, inputConfig);

	// Create Cloudflare handler
	const handler = {
		fetch: (request, env, ctx) => {
			return CF_AMBIENT_ENV.run(env, () => router.fetch(request, env, ctx));
		},
	} satisfies ExportedHandler<Bindings>;

	return { handler, WorkerHandler };
}

export function createRouter(
	registry: Registry<any>,
	inputConfig?: InputConfig,
): {
	router: Hono<{ Bindings: Bindings }>;
	WorkerHandler: DurableObjectConstructor;
} {
	const config = ConfigSchema.parse(inputConfig);
	const runConfig = {
		driver: {
			topology: "partition",
			manager: new CloudflareWorkersManagerDriver(),
			// HACK: We can't build the worker driver until we're inside the Druable Object
			worker: undefined as any,
		},
		getUpgradeWebSocket: () => upgradeWebSocket,
		...config,
	} satisfies RunConfig;

	// Create Durable Object
	const WorkerHandler = createWorkerDurableObject(registry, runConfig);

	const managerTopology = new PartitionTopologyManager(
		registry.config,
		runConfig,
		{
			sendRequest: async (workerId, workerRequest): Promise<Response> => {
				const env = getCloudflareAmbientEnv();

				logger().debug("sending request to durable object", {
					workerId,
					method: workerRequest.method,
					url: workerRequest.url,
				});

				const id = env.WORKER_DO.idFromString(workerId);
				const stub = env.WORKER_DO.get(id);

				return await stub.fetch(workerRequest);
			},

			openWebSocket: async (
				workerId,
				encodingKind: Encoding,
				params: unknown,
			): Promise<WebSocket> => {
				const env = getCloudflareAmbientEnv();

				logger().debug("opening websocket to durable object", { workerId });

				// Make a fetch request to the Durable Object with WebSocket upgrade
				const id = env.WORKER_DO.idFromString(workerId);
				const stub = env.WORKER_DO.get(id);

				const headers: Record<string, string> = {
					Upgrade: "websocket",
					Connection: "Upgrade",
					[HEADER_EXPOSE_INTERNAL_ERROR]: "true",
					[HEADER_ENCODING]: encodingKind,
				};
				if (params) {
					headers[HEADER_CONN_PARAMS] = JSON.stringify(params);
				}
				// HACK: See packages/platforms/cloudflare-workers/src/websocket.ts
				headers["sec-websocket-protocol"] = "rivetkit";

				const response = await stub.fetch("http://worker/connect/websocket", {
					headers,
				});
				const webSocket = response.webSocket;

				if (!webSocket) {
					throw new InternalError(
						"missing websocket connection in response from DO",
					);
				}

				logger().debug("durable object websocket connection open", {
					workerId,
				});

				webSocket.accept();

				// TODO: Is this still needed?
				// HACK: Cloudflare does not call onopen automatically, so we need
				// to call this on the next tick
				setTimeout(() => {
					(webSocket as any).onopen?.(new Event("open"));
				}, 0);

				return webSocket as unknown as WebSocket;
			},

			proxyRequest: async (c, workerRequest, workerId): Promise<Response> => {
				logger().debug("forwarding request to durable object", {
					workerId,
					method: workerRequest.method,
					url: workerRequest.url,
				});

				const id = c.env.WORKER_DO.idFromString(workerId);
				const stub = c.env.WORKER_DO.get(id);

				return await stub.fetch(workerRequest);
			},
			proxyWebSocket: async (c, path, workerId, encoding, params, authData) => {
				logger().debug("forwarding websocket to durable object", {
					workerId,
					path,
				});

				// Validate upgrade
				const upgradeHeader = c.req.header("Upgrade");
				if (!upgradeHeader || upgradeHeader !== "websocket") {
					return new Response("Expected Upgrade: websocket", {
						status: 426,
					});
				}

				// TODO: strip headers
				const newUrl = new URL(`http://worker${path}`);
				const workerRequest = new Request(newUrl, c.req.raw);

				// Always build fresh request to prevent forwarding unwanted headers
				// HACK: Since we can't build a new request, we need to remove
				// non-standard headers manually
				const headerKeys: string[] = [];
				workerRequest.headers.forEach((v, k) => headerKeys.push(k));
				for (const k of headerKeys) {
					if (!STANDARD_WEBSOCKET_HEADERS.includes(k)) {
						workerRequest.headers.delete(k);
					}
				}

				// Add RivetKit headers
				workerRequest.headers.set(HEADER_EXPOSE_INTERNAL_ERROR, "true");
				workerRequest.headers.set(HEADER_ENCODING, encoding);
				if (params) {
					workerRequest.headers.set(HEADER_CONN_PARAMS, JSON.stringify(params));
				}
				if (authData) {
					workerRequest.headers.set(HEADER_AUTH_DATA, JSON.stringify(authData));
				}

				const id = c.env.WORKER_DO.idFromString(workerId);
				const stub = c.env.WORKER_DO.get(id);

				return await stub.fetch(workerRequest);
			},
		},
	);

	// Force the router to have access to the Cloudflare bindings
	const router = managerTopology.router as unknown as Hono<{
		Bindings: Bindings;
	}>;

	return { router, WorkerHandler };
}
