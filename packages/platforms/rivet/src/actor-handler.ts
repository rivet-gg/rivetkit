import { setupLogging } from "actor-core/log";
import type { ActorContext } from "@rivet-gg/actor-core";
import { upgradeWebSocket } from "hono/deno";
import { logger } from "./log";
import type { RivetHandler } from "./util";
import { deserializeKeyFromTag } from "./util";
import { PartitionTopologyActor } from "actor-core/topologies/partition";
import { ConfigSchema, type InputConfig } from "./config";
import { RivetActorDriver } from "./actor-driver";
import { rivetRequest } from "./rivet-client";
import invariant from "invariant";

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

			const endpoint = Deno.env.get("RIVET_API_ENDPOINT");
			if (!endpoint) throw new Error("missing RIVET_API_ENDPOINT");

			// Setup actor driver
			if (!driverConfig.drivers) driverConfig.drivers = {};
			if (!driverConfig.drivers.actor) {
				driverConfig.drivers.actor = new RivetActorDriver(ctx);
			}

			// Setup WebSocket upgrader
			if (!driverConfig.getUpgradeWebSocket) {
				driverConfig.getUpgradeWebSocket = () => upgradeWebSocket;
			}

			driverConfig.app.config.inspector = {
				enabled: true,
				onRequest: async (c) => {
					const url = new URL(c.req.url);
					const token = url.searchParams.get("token");

					if (!token) {
						return false;
					}

					try {
						const response = await rivetRequest<void, { agent: unknown }>(
							{ endpoint, token },
							"GET",
							"/cloud/auth/inspect",
						);
						return "agent" in response;
					} catch (e) {
						return false;
					}
				},
			};

			const corsConfig = driverConfig.app.config.cors;

			// Enable CORS for Rivet domains
			driverConfig.app.config.cors = {
				...driverConfig.app.config.cors,
				origin: (origin, c) => {
					const isRivetOrigin =
						origin.endsWith(".rivet.gg") || origin.includes("localhost:");
					const configOrigin = corsConfig?.origin;

					if (isRivetOrigin) {
						return origin;
					}
					if (typeof configOrigin === "function") {
						return configOrigin(origin, c);
					}
					if (typeof configOrigin === "string") {
						return configOrigin;
					}
					return null;
				},
			};

			// Create actor topology
			driverConfig.topology = driverConfig.topology ?? "partition";
			const actorTopology = new PartitionTopologyActor(
				driverConfig.app.config,
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

			// Extract key from Rivet's tag format
			const key = extractKeyFromRivetTags(ctx.metadata.actor.tags);

			// Start actor
			await actorTopology.start(
				ctx.metadata.actor.id,
				ctx.metadata.actor.tags.name,
				key,
				ctx.metadata.region.id,
			);

			// Wait for server
			await server.finished;
		},
	} satisfies RivetHandler;

	return handler;
}

// Helper function to extract key array from Rivet's tag format
function extractKeyFromRivetTags(tags: Record<string, string>): string[] {
	invariant(typeof tags.key === "string", "key tag does not exist");
	return deserializeKeyFromTag(tags.key);
}
