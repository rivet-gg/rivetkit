import {
	type DurableObjectConstructor,
	type ActorHandlerInterface,
	createActorDurableObject,
} from "./actor_handler_do";
import { ConfigSchema, type InputConfig } from "./config";
import { assertUnreachable } from "actor-core/utils";
import type { Hono } from "hono";
import { PartitionTopologyManager } from "actor-core/topologies/partition";
import { logger } from "./log";
import { CloudflareWorkersManagerDriver } from "./manager_driver";
import { ActorCoreApp } from "actor-core";
import { upgradeWebSocket } from "./websocket";

/** Cloudflare Workers env */
export interface Bindings {
	ACTOR_KV: KVNamespace;
	ACTOR_DO: DurableObjectNamespace<ActorHandlerInterface>;
}

export function createHandler(
	app: ActorCoreApp<any>,
	inputConfig?: InputConfig,
): {
	handler: ExportedHandler<Bindings>;
	ActorHandler: DurableObjectConstructor;
} {
	// Create router
	const { router, ActorHandler } = createRouter(app, inputConfig);

	// Create Cloudflare handler
	const handler = {
		fetch: router.fetch,
	} satisfies ExportedHandler<Bindings>;

	return { handler, ActorHandler };
}

export function createRouter(
	app: ActorCoreApp<any>,
	inputConfig?: InputConfig,
): {
	router: Hono<{ Bindings: Bindings }>;
	ActorHandler: DurableObjectConstructor;
} {
	const driverConfig = ConfigSchema.parse(inputConfig);

	// Configur drivers
	//
	// Actor driver will get set in `ActorHandler`
	if (!driverConfig.drivers) driverConfig.drivers = {};
	if (!driverConfig.drivers.manager)
		driverConfig.drivers.manager = new CloudflareWorkersManagerDriver();

	// Setup WebSockets
	if (!driverConfig.getUpgradeWebSocket)
		driverConfig.getUpgradeWebSocket = () => upgradeWebSocket;

	// Create Durable Object
	const ActorHandler = createActorDurableObject(app, driverConfig);

	driverConfig.topology = driverConfig.topology ?? "partition";
	if (driverConfig.topology === "partition") {
		const managerTopology = new PartitionTopologyManager(
			app.config,
			driverConfig,
			{
				onProxyRequest: async (c, actorRequest, actorId): Promise<Response> => {
					logger().debug("forwarding request to durable object", {
						actorId,
						method: actorRequest.method,
						url: actorRequest.url,
					});

					const id = c.env.ACTOR_DO.idFromString(actorId);
					const stub = c.env.ACTOR_DO.get(id);

					return await stub.fetch(actorRequest);
				},
				onProxyWebSocket: async (c, path, actorId) => {
					logger().debug("forwarding websocket to durable object", {
						actorId,
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
					const newUrl = new URL(`http://actor${path}`);
					const actorRequest = new Request(newUrl, c.req.raw);

					const id = c.env.ACTOR_DO.idFromString(actorId);
					const stub = c.env.ACTOR_DO.get(id);

					return await stub.fetch(actorRequest);
				},
			},
		);

		// Force the router to have access to the Cloudflare bindings
		const router = managerTopology.router as unknown as Hono<{
			Bindings: Bindings;
		}>;

		return { router, ActorHandler };
	} else if (
		driverConfig.topology === "standalone" ||
		driverConfig.topology === "coordinate"
	) {
		throw new Error("Cloudflare only supports partition topology.");
	} else {
		assertUnreachable(driverConfig.topology);
	}
}
