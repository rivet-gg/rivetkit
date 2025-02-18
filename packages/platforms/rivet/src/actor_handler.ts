import { setupLogging } from "actor-core/log";
import type { ActorContext } from "@rivet-gg/actor-core";
import type { ActorTags } from "actor-core";
import { upgradeWebSocket } from "hono/deno";
import { logger } from "./log";
import type { RivetHandler } from "./util";
import { PartitionTopologyActor } from "actor-core/topologies/partition";
import type { Config } from "./config";
import { RivetActorDriver } from "./actor_driver";

export function createActorHandler(
	config: Config,
): RivetHandler {
	const handler = {
		async start(ctx: ActorContext): Promise<void> {
			setupLogging();

			const portStr = Deno.env.get("PORT_HTTP");
			if (!portStr) {
				throw "Missing port";
			}
			const port = Number.parseInt(portStr);
			if (!Number.isFinite(port)) {
				throw "Invalid port";
			}

			// Setup actor driver
			if (!config.drivers) config.drivers = {};
			if (!config.drivers.actor) {
				config.drivers.actor = new RivetActorDriver(ctx);
			}
			
			// Setup WebSocket upgrader
			if (!config.router) config.router = {};
			if (!config.router.getUpgradeWebSocket) {
				config.router.getUpgradeWebSocket = () => upgradeWebSocket;
			}

			// Create actor topology
			config.topology = config.topology ?? "partition";
			const actorTopology = new PartitionTopologyActor(config);

			// Set a catch-all route
			const router = actorTopology.router;
			router.all("*", (c) => {
				return c.text("Not Found (ActorCore)", 404);
			});

			// Start server
			logger().info("server running", { port });
			const server = Deno.serve(
				{
					port,
					hostname: "0.0.0.0",
					// Remove "Listening on ..." message
					onListen() {},
				},
				router.fetch,
			);

			// Start actor
			await actorTopology.start(
				ctx.metadata.actor.id,
				ctx.metadata.actor.tags as ActorTags,
				ctx.metadata.region.id,
			);

			// Wait for server
			await server.finished;
		},
	} satisfies RivetHandler;

	return handler;
}

