import { setupLogging } from "@/common/log";
import type { Registry, RunConfig } from "@/registry/mod";
import { PartitionTopologyManager } from "@/topologies/partition/mod";
import { serve as honoServe } from "@hono/node-server";
import { type NodeWebSocket, createNodeWebSocket } from "@hono/node-ws";
import { ConfigSchema, type InputConfig } from "./config";
import { logger } from "./log";
import { RivetManagerDriver } from "./manager-driver";
import type { RivetClientConfig } from "./rivet-client";

export async function startManager(
	registry: Registry<any>,
	inputConfig?: InputConfig,
): Promise<void> {
	setupLogging();

	const portStr = process.env.PORT_HTTP;
	if (!portStr) {
		throw "Missing port";
	}
	const port = Number.parseInt(portStr);
	if (!Number.isFinite(port)) {
		throw "Invalid port";
	}

	const endpoint = process.env.RIVET_ENDPOINT;
	if (!endpoint) throw new Error("missing RIVET_ENDPOINT");
	const token = process.env.RIVET_SERVICE_TOKEN;
	if (!token) throw new Error("missing RIVET_SERVICE_TOKEN");
	const project = process.env.RIVET_PROJECT;
	if (!project) throw new Error("missing RIVET_PROJECT");
	const environment = process.env.RIVET_ENVIRONMENT;
	if (!environment) throw new Error("missing RIVET_ENVIRONMENT");

	const clientConfig: RivetClientConfig = {
		endpoint,
		token,
		project,
		environment,
	};

	const config = ConfigSchema.parse(inputConfig);
	let injectWebSocket: NodeWebSocket["injectWebSocket"] | undefined;
	const runConfig = {
		driver: {
			topology: "partition",
			manager: new RivetManagerDriver(clientConfig),
			// HACK: We can't build the actor driver until we're inside the actor
			actor: undefined as any,
		},
		// Setup WebSocket routing for Node
		//
		// Save `injectWebSocket` for after server is created
		getUpgradeWebSocket: (app) => {
			const webSocket = createNodeWebSocket({ app });
			injectWebSocket = webSocket.injectWebSocket;
			return webSocket.upgradeWebSocket;
		},
		...config,
	} satisfies RunConfig;

	//// Force disable inspector
	//driverConfig.registry.config.inspector = {
	//	enabled: false,
	//};

	//const corsConfig = driverConfig.registry.config.cors;
	//
	//// Enable CORS for Rivet domains
	//driverConfig.registry.config.cors = {
	//	...driverConfig.registry.config.cors,
	//	origin: (origin, c) => {
	//		const isRivetOrigin =
	//			origin.endsWith(".rivet.gg") || origin.includes("localhost:");
	//		const configOrigin = corsConfig?.origin;
	//
	//		if (isRivetOrigin) {
	//			return origin;
	//		}
	//		if (typeof configOrigin === "function") {
	//			return configOrigin(origin, c);
	//		}
	//		if (typeof configOrigin === "string") {
	//			return configOrigin;
	//		}
	//		return null;
	//	},
	//};

	// Create manager topology
	const managerTopology = new PartitionTopologyManager(
		registry.config,
		runConfig,
	);

	// Start server with ambient env wrapper
	logger().info("server running", { port });
	const server = honoServe({
		fetch: managerTopology.router.fetch,
		hostname: "0.0.0.0",
		port,
	});
	if (!injectWebSocket) throw new Error("injectWebSocket not defined");
	injectWebSocket(server);
}
