import { setupLogging } from "actor-core/log";
import type { ActorContext } from "@rivet-gg/actor-core";
import { logger } from "./log";
import { RivetManagerDriver } from "./manager_driver";
import type { RivetClientConfig } from "./rivet_client";
import type { RivetHandler } from "./util";
import { PartitionTopologyManager } from "actor-core/topologies/partition";
import { type InputConfig, ConfigSchema } from "./config";

export function createManagerHandler(inputConfig: InputConfig): RivetHandler {
	const config = ConfigSchema.parse(inputConfig);

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

			const endpoint = Deno.env.get("RIVET_API_ENDPOINT");
			if (!endpoint) throw new Error("missing RIVET_API_ENDPOINT");
			const token = Deno.env.get("RIVET_SERVICE_TOKEN");
			if (!token) throw new Error("missing RIVET_SERVICE_TOKEN");

			const clientConfig: RivetClientConfig = {
				endpoint,
				token,
				project: ctx.metadata.project.slug,
				environment: ctx.metadata.environment.slug,
			};

			// Setup manager driver
			if (!config.drivers) config.drivers = {};
			if (!config.drivers.manager) {
				config.drivers.manager = new RivetManagerDriver(clientConfig);
			}

			// Create manager topology
			config.topology = config.topology ?? "partition";
			const managerTopology = new PartitionTopologyManager(config);

			const app = managerTopology.router;

			app.all("*", (c) => {
				return c.text("Not Found (ActorCore)", 404);
			});

			logger().info("server running", { port });
			const server = Deno.serve(
				{
					port,
					hostname: "0.0.0.0",
					// Remove "Listening on ..." message
					onListen() {},
				},
				app.fetch,
			);
			await server.finished;
		},
	} satisfies RivetHandler;

	return handler;
}
