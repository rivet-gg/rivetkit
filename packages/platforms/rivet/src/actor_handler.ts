import { setupLogging } from "actor-core/log";
import type { ActorContext } from "@rivet-gg/actor-core";
import type { ActorTags } from "actor-core";
import { upgradeWebSocket } from "hono/deno";
import { logger } from "./log";
import type { RivetHandler } from "./util";
import { PartitionTopologyActor } from "actor-core/topologies/partition";
import { ConfigSchema, type InputConfig } from "./config";
import { RivetActorDriver } from "./actor_driver";

export function createActorHandler(inputConfig: InputConfig): RivetHandler {
	const driverConfig = ConfigSchema.parse(inputConfig);

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
			if (!driverConfig.drivers) driverConfig.drivers = {};
			if (!driverConfig.drivers.actor) {
				driverConfig.drivers.actor = new RivetActorDriver(ctx);
			}

			// Setup WebSocket upgrader
			if (!driverConfig.getUpgradeWebSocket) {
				driverConfig.getUpgradeWebSocket = () => upgradeWebSocket;
			}

			// Create actor topology
			driverConfig.topology = driverConfig.topology ?? "partition";
			const actorTopology = new PartitionTopologyActor(
				inputConfig.app.config,
				driverConfig,
			);

			// Set a catch-all route
			const router = actorTopology.router;

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

			// Assert name exists
			if (!("name" in ctx.metadata.actor.tags)) {
				throw new Error(
					`Tags for actor ${ctx.metadata.actor.id} do not contain property name: ${JSON.stringify(ctx.metadata.actor.tags)}`,
				);
			}

			// Start actor
			await actorTopology.start(
				ctx.metadata.actor.id,
				ctx.metadata.actor.tags.name,
				ctx.metadata.actor.tags as ActorTags,
				ctx.metadata.region.id,
			);

			// Wait for server
			await server.finished;
		},
	} satisfies RivetHandler;

	return handler;
}
