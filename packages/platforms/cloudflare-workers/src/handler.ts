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

/** Cloudflare Workers env */
export interface Env {
	ACTOR_KV: KVNamespace;
	ACTOR_DO: DurableObjectNamespace<ActorHandlerInterface>;
}

/** Cloudflare Workers handler */
export interface Handler {
	handler: ExportedHandler<Env>;
	ActorHandler: DurableObjectConstructor;
}

export function createHandler(inputConfig: InputConfig): Handler {
	const config = ConfigSchema.parse(inputConfig);

	const ActorHandler = createActorDurableObject(config);

	const handler = {
		async fetch(request, env: Env, ctx: ExecutionContext): Promise<Response> {
			// TODO: Move creating router to a shared context by passing KV & DO directly to manager somehow
			const router = createRouter(inputConfig, env.ACTOR_KV, env.ACTOR_DO);
			return await router.fetch(request, env, ctx);
		},
	} satisfies ExportedHandler<Env>;

	return { handler, ActorHandler };
}

export function createRouter(
	inputConfig: InputConfig,
	actorKvNs: KVNamespace,
	actorDoNs: DurableObjectNamespace<ActorHandlerInterface>,
): Hono {
	const config = ConfigSchema.parse(inputConfig);

	if (!config.drivers) config.drivers = {};
	if (!config.drivers.manager)
		config.drivers.manager = new CloudflareWorkersManagerDriver(
			actorKvNs,
			actorDoNs,
		);

	config.topology = config.topology ?? "partition";
	if (config.topology === "partition") {
		const managerTopology = new PartitionTopologyManager(config);

		const app = managerTopology.router;

		// Forward requests to actor
		app.all("/actors/:actorId/:path{.+}", (c) => {
			const actorId = c.req.param("actorId");
			const subpath = `/${c.req.param("path")}`;
			logger().debug("forwarding request", { actorId, subpath });

			const id = actorDoNs.idFromString(actorId);
			const stub = actorDoNs.get(id);

			// Modify the path to remove the prefix
			const url = new URL(c.req.url);
			url.pathname = subpath;
			const actorRequest = new Request(url.toString(), c.req.raw);

			return stub.fetch(actorRequest);
		});

		app.all("*", (c) => {
			return c.text("Not Found (ActorCore)", 404);
		});

		return app;
	} else if (
		config.topology === "standalone" ||
		config.topology === "coordinate"
	) {
		throw new Error("Cloudflare only supports partition topology.");
	} else {
		assertUnreachable(config.topology);
	}
}
