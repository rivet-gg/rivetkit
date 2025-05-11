import { setupLogging } from "actor-core/log";
import type { ActorContext } from "@rivet-gg/actor-core";
import { logger } from "./log";
import { GetActorMeta, RivetManagerDriver } from "./manager_driver";
import type { RivetClientConfig } from "./rivet_client";
import type { RivetHandler } from "./util";
import { createWebSocketProxy } from "./ws_proxy";
import { PartitionTopologyManager } from "actor-core/topologies/partition";
import { type InputConfig, ConfigSchema } from "./config";
import { proxy } from "hono/proxy";
import invariant from "invariant";
import { upgradeWebSocket } from "hono/deno";

export function createManagerHandler(inputConfig: InputConfig): RivetHandler {
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
			const token = Deno.env.get("RIVET_SERVICE_TOKEN");
			if (!token) throw new Error("missing RIVET_SERVICE_TOKEN");

			const clientConfig: RivetClientConfig = {
				endpoint,
				token,
				project: ctx.metadata.project.slug,
				environment: ctx.metadata.environment.slug,
			};

			// Force disable inspector
			driverConfig.app.config.inspector = {
				enabled: false,
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

			// Setup manager driver
			if (!driverConfig.drivers) driverConfig.drivers = {};
			if (!driverConfig.drivers.manager) {
				driverConfig.drivers.manager = new RivetManagerDriver(clientConfig);
			}

			// Setup WebSocket upgrader
			if (!driverConfig.getUpgradeWebSocket) {
				driverConfig.getUpgradeWebSocket = () => upgradeWebSocket;
			}

			// Create manager topology
			driverConfig.topology = driverConfig.topology ?? "partition";
			const managerTopology = new PartitionTopologyManager(
				driverConfig.app.config,
				driverConfig,
				{
					onProxyRequest: async (c, actorRequest, _actorId, metaRaw) => {
						invariant(metaRaw, "meta not provided");
						const meta = metaRaw as GetActorMeta;

						const parsedRequestUrl = new URL(actorRequest.url);
						const actorUrl = `${meta.endpoint}${parsedRequestUrl.pathname}${parsedRequestUrl.search}`;

						logger().debug("proxying request to rivet actor", {
							method: actorRequest.method,
							url: actorUrl,
						});

						const proxyRequest = new Request(actorUrl, actorRequest);
						return await proxy(proxyRequest);
					},
					onProxyWebSocket: async (c, path, actorId, metaRaw) => {
						invariant(metaRaw, "meta not provided");
						const meta = metaRaw as GetActorMeta;

						const actorUrl = `${meta.endpoint}${path}`;

						logger().debug("proxying websocket to rivet actor", {
							url: actorUrl,
						});

						// TODO: fix as any
						return createWebSocketProxy(c, actorUrl) as any;
					},
				},
			);

			const app = managerTopology.router;

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
