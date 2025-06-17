import {
	type DurableObjectConstructor,
	type WorkerHandlerInterface,
	createWorkerDurableObject,
} from "./worker-handler-do";
import { ConfigSchema, type InputConfig } from "./config";
import { assertUnreachable } from "rivetkit/utils";
import type { Hono } from "hono";
import { PartitionTopologyManager } from "rivetkit/topologies/partition";
import { logger } from "./log";
import { CloudflareWorkersManagerDriver } from "./manager-driver";
import { Encoding, Registry } from "rivetkit";
import { upgradeWebSocket } from "./websocket";
import invariant from "invariant";
import { AsyncLocalStorage } from "node:async_hooks";
import { InternalError } from "rivetkit/errors";

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
	const driverConfig = ConfigSchema.parse(inputConfig);

	// Configure drivers
	//
	// Worker driver will get set in `WorkerHandler`
	if (!driverConfig.drivers) driverConfig.drivers = {};
	if (!driverConfig.drivers.manager)
		driverConfig.drivers.manager = new CloudflareWorkersManagerDriver();

	// Setup WebSockets
	if (!driverConfig.getUpgradeWebSocket)
		driverConfig.getUpgradeWebSocket = () => upgradeWebSocket;

	// Create Durable Object
	const WorkerHandler = createWorkerDurableObject(registry, driverConfig);

	driverConfig.topology = driverConfig.topology ?? "partition";
	if (driverConfig.topology === "partition") {
		const managerTopology = new PartitionTopologyManager(
			registry.config,
			driverConfig,
			{
				sendRequest: async (
					workerId,
					meta,
					workerRequest,
				): Promise<Response> => {
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
					meta,
					encodingKind: Encoding,
				): Promise<WebSocket> => {
					const env = getCloudflareAmbientEnv();

					logger().debug("opening websocket to durable object", { workerId });

					// Make a fetch request to the Durable Object with WebSocket upgrade
					const id = env.WORKER_DO.idFromString(workerId);
					const stub = env.WORKER_DO.get(id);

					// TODO: this doesn't call on open
					const url = `http://worker/connect/websocket?encoding=${encodingKind}&expose-internal-error=true`;
					const response = await stub.fetch(url, {
						headers: {
							Upgrade: "websocket",
							Connection: "Upgrade",
						},
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

					return webSocket;
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
				proxyWebSocket: async (c, path, workerId) => {
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

					// Update path on URL
					const newUrl = new URL(`http://worker${path}`);
					const workerRequest = new Request(newUrl, c.req.raw);

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
	} else if (
		driverConfig.topology === "standalone" ||
		driverConfig.topology === "coordinate"
	) {
		throw new Error("Cloudflare only supports partition topology.");
	} else {
		assertUnreachable(driverConfig.topology);
	}
}
