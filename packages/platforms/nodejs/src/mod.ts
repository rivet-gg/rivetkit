import { serve as honoServe } from "@hono/node-server";
import { createNodeWebSocket, type NodeWebSocket } from "@hono/node-ws";
import { assertUnreachable } from "actor-core/utils";
import { CoordinateTopology } from "actor-core/topologies/coordinate";
import type { Config } from "./config";
import { logger } from "./log";
import type { Hono } from "hono";
import { StandaloneTopology } from "actor-core";
import { MemoryManagerDriver } from "@actor-core/memory/manager";
import { MemoryActorDriver } from "@actor-core/memory/actor";

export function createRouter(config: Config): {
	router: Hono;
	injectWebSocket: NodeWebSocket["injectWebSocket"];
} {
	// Configure default configuration
	if (!config.topology) config.topology = "standalone";
	if (!config.drivers) config.drivers = {};
	if (!config.drivers.manager)
		config.drivers.manager = new MemoryManagerDriver();
	if (!config.drivers.actor) config.drivers.actor = new MemoryActorDriver();

	// Setup WebSocket routing for Node
	//
	// Save `injectWebSocket` for after server is created
	let injectWebSocket: NodeWebSocket["injectWebSocket"] | undefined;
	if (!config.router) config.router = {};
	config.router.getUpgradeWebSocket = (app) => {
		const webSocket = createNodeWebSocket({ app });
		injectWebSocket = webSocket.injectWebSocket;
		return webSocket.upgradeWebSocket;
	};

	// Setup topology
	if (config.topology === "standalone") {
		const topology = new StandaloneTopology(config);
		if (!injectWebSocket) throw new Error("injectWebSocket not defined");
		return { router: topology.router, injectWebSocket };
	} else if (config.topology === "partition") {
		throw new Error("Node.js only supports standalone & coordinate topology.");
	} else if (config.topology === "coordinate") {
		const topology = new CoordinateTopology(config);
		if (!injectWebSocket) throw new Error("injectWebSocket not defined");
		return { router: topology.router, injectWebSocket };
	} else {
		assertUnreachable(config.topology);
	}
}

export function serve(config: Config) {
	const { router, injectWebSocket } = createRouter(config);

	const hostname = config.server?.hostname ?? process.env.HOSTNAME;
	const port =
		config.server?.port ?? Number.parseInt(process.env.PORT ?? "8787");

	const server = honoServe({
		fetch: router.fetch,
		hostname,
		port,
	});
	injectWebSocket(server);

	logger().info("actorcore started", { hostname, port });
}
