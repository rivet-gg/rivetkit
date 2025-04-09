import { serve as honoServe, type ServerType } from "@hono/node-server";
import { createNodeWebSocket, type NodeWebSocket } from "@hono/node-ws";
import { assertUnreachable } from "@/utils";
import { CoordinateTopology } from "@/topologies/coordinate/mod";
import { logger } from "./log";
import type { Hono } from "hono";
import { StandaloneTopology, type ActorCoreApp } from "@/mod";
import {
	TestGlobalState,
	TestManagerDriver,
	TestActorDriver,
} from "./driver/mod";
import { type InputConfig, ConfigSchema } from "./config";
import { onTestFinished, vi } from "vitest";
import getPort from "get-port";
import { type Client, createClient } from "@/client/mod";

function createRouter(
	app: ActorCoreApp<any>,
	inputConfig?: InputConfig,
): {
	router: Hono;
	injectWebSocket: NodeWebSocket["injectWebSocket"];
} {
	const config = ConfigSchema.parse(inputConfig);

	// Configure default configuration
	if (!config.topology) config.topology = "standalone";
	if (!config.drivers.manager || !config.drivers.actor) {
		const memoryState = new TestGlobalState();
		if (!config.drivers.manager) {
			config.drivers.manager = new TestManagerDriver(app, memoryState);
		}
		if (!config.drivers.actor) {
			config.drivers.actor = new TestActorDriver(memoryState);
		}
	}

	// Setup WebSocket routing for Node
	//
	// Save `injectWebSocket` for after server is created
	let injectWebSocket: NodeWebSocket["injectWebSocket"] | undefined;
	if (!config.getUpgradeWebSocket) {
		config.getUpgradeWebSocket = (app) => {
			const webSocket = createNodeWebSocket({ app });
			injectWebSocket = webSocket.injectWebSocket;
			return webSocket.upgradeWebSocket;
		};
	}

	// Setup topology
	if (config.topology === "standalone") {
		const topology = new StandaloneTopology(app.config, config);
		if (!injectWebSocket) throw new Error("injectWebSocket not defined");
		return { router: topology.router, injectWebSocket };
	} else if (config.topology === "partition") {
		throw new Error("Node.js only supports standalone & coordinate topology.");
	} else if (config.topology === "coordinate") {
		const topology = new CoordinateTopology(app.config, config);
		if (!injectWebSocket) throw new Error("injectWebSocket not defined");
		return { router: topology.router, injectWebSocket };
	} else {
		assertUnreachable(config.topology);
	}
}

function serve(app: ActorCoreApp<any>, inputConfig?: InputConfig): ServerType {
	const config = ConfigSchema.parse(inputConfig);

	const { router, injectWebSocket } = createRouter(app, config);

	const server = honoServe({
		fetch: router.fetch,
		hostname: config.hostname,
		port: config.port,
	});
	injectWebSocket(server);

	logger().info("actorcore started", {
		hostname: config.hostname,
		port: config.port,
	});

	return server;
}

export interface SetupTestResult<A extends ActorCoreApp<any>> {
	client: Client<A>;
	mockDriver: {
		actorDriver: {
			setCreateVarsContext: (ctx: any) => void;
		};
	};
}

export async function setupTest<A extends ActorCoreApp<any>>(
	app: A,
): Promise<SetupTestResult<A>> {
	vi.useFakeTimers();

	// Set up mock driver for testing createVars context
	const mockDriverContext: any = {};
	let setDriverContextFn = (ctx: any) => {
		mockDriverContext.current = ctx;
	};

	// We don't need to modify the driver context anymore since we're testing with the actual context

	// Start server with a random port
	const port = await getPort();
	const server = serve(app, { port });
	onTestFinished(
		async () => await new Promise((resolve) => server.close(() => resolve())),
	);

	// Create client
	const client = createClient<A>(`http://127.0.0.1:${port}`);
	onTestFinished(async () => await client.dispose());

	return {
		client,
		mockDriver: {
			actorDriver: {
				setCreateVarsContext: setDriverContextFn,
			},
		},
	};
}
