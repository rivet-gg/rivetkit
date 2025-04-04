import type { Serve, Server, ServerWebSocket, WebSocketHandler } from "bun";
import { assertUnreachable } from "actor-core/utils";
import { CoordinateTopology } from "actor-core/topologies/coordinate";
import { ConfigSchema, type InputConfig } from "./config";
import { logger } from "./log";
import { createBunWebSocket } from "hono/bun";
import type { Hono } from "hono";
import { type ActorCoreApp, StandaloneTopology } from "actor-core";
import {
	MemoryGlobalState,
	MemoryManagerDriver,
	MemoryActorDriver,
} from "@actor-core/memory";
import { FileSystemActorDriver, FileSystemGlobalState, FileSystemManagerDriver } from "@actor-core/file-system";

export { InputConfig as Config } from "./config";

export function createRouter(
	app: ActorCoreApp<any>,
	inputConfig?: InputConfig,
): {
	router: Hono;
	webSocketHandler: WebSocketHandler;
} {
	const config = ConfigSchema.parse(inputConfig);

	// Setup WebSocket routing for Bun
	const webSocket = createBunWebSocket<ServerWebSocket>();
	if (!config.getUpgradeWebSocket) {
		config.getUpgradeWebSocket = () => webSocket.upgradeWebSocket;
	}

	// HACK: Hono BunWebSocketHandler type is not compatible with Bun's
	const webSocketHandler = webSocket.websocket as unknown as WebSocketHandler;

	// Configure default configuration
	if (!config.topology) config.topology = "standalone";
	if (!config.drivers.manager || !config.drivers.actor) {
		if (config.mode === "file-system") {
			const fsState = new FileSystemGlobalState();
			if (!config.drivers.manager) {
				config.drivers.manager = new FileSystemManagerDriver(app, fsState);
			}
			if (!config.drivers.actor) {
				config.drivers.actor = new FileSystemActorDriver(fsState);
			}
		} else if (config.mode === "memory") {
			const memoryState = new MemoryGlobalState();
			if (!config.drivers.manager) {
				config.drivers.manager = new MemoryManagerDriver(app, memoryState);
			}
			if (!config.drivers.actor) {
				config.drivers.actor = new MemoryActorDriver(memoryState);
			}
		} else {
			assertUnreachable(config.mode);
		}
	}

	// Setup topology
	if (config.topology === "standalone") {
		const topology = new StandaloneTopology(app.config, config);
		return { router: topology.router, webSocketHandler };
	} else if (config.topology === "partition") {
		throw new Error("Bun only supports standalone & coordinate topology.");
	} else if (config.topology === "coordinate") {
		const topology = new CoordinateTopology(app.config, config);
		return { router: topology.router, webSocketHandler };
	} else {
		assertUnreachable(config.topology);
	}
}

export function createHandler(
	app: ActorCoreApp<any>,
	inputConfig?: InputConfig,
): Serve {
	const config = ConfigSchema.parse(inputConfig);

	const { router, webSocketHandler } = createRouter(app, config);

	return {
		hostname: config.hostname,
		port: config.port,
		fetch: router.fetch,
		websocket: webSocketHandler,
	};
}

export function serve(
	app: ActorCoreApp<any>,
	inputConfig: InputConfig,
): Server {
	const config = ConfigSchema.parse(inputConfig);

	const handler = createHandler(app, config);
	const server = Bun.serve(handler);

	logger().info("actorcore started", {
		hostname: config.hostname,
		port: config.port,
	});

	return server;
}
