import type { Serve, Server, ServerWebSocket, WebSocketHandler } from "bun";
import { assertUnreachable } from "rivetkit/utils";
import { CoordinateTopology } from "rivetkit/topologies/coordinate";
import { ConfigSchema, type InputConfig } from "./config";
import { logger } from "./log";
import { createBunWebSocket } from "hono/bun";
import type { Hono } from "hono";
import { type Registry, StandaloneTopology } from "rivetkit";
import {
	MemoryGlobalState,
	MemoryManagerDriver,
	MemoryWorkerDriver,
} from "@rivetkit/memory";
import { FileSystemWorkerDriver, FileSystemGlobalState, FileSystemManagerDriver } from "@rivetkit/file-system";

export { InputConfig as Config } from "./config";

export function createRouter(
	registry: Registry<any>,
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
	if (!config.drivers.manager || !config.drivers.worker) {
		if (config.mode === "file-system") {
			const fsState = new FileSystemGlobalState();
			if (!config.drivers.manager) {
				config.drivers.manager = new FileSystemManagerDriver(registry, fsState);
			}
			if (!config.drivers.worker) {
				config.drivers.worker = new FileSystemWorkerDriver(fsState);
			}
		} else if (config.mode === "memory") {
			const memoryState = new MemoryGlobalState();
			if (!config.drivers.manager) {
				config.drivers.manager = new MemoryManagerDriver(registry, memoryState);
			}
			if (!config.drivers.worker) {
				config.drivers.worker = new MemoryWorkerDriver(memoryState);
			}
		} else {
			assertUnreachable(config.mode);
		}
	}

	// Setup topology
	if (config.topology === "standalone") {
		const topology = new StandaloneTopology(registry.config, config);
		return { router: topology.router, webSocketHandler };
	} else if (config.topology === "partition") {
		throw new Error("Bun only supports standalone & coordinate topology.");
	} else if (config.topology === "coordinate") {
		const topology = new CoordinateTopology(registry.config, config);
		return { router: topology.router, webSocketHandler };
	} else {
		assertUnreachable(config.topology);
	}
}

export function createHandler(
	registry: Registry<any>,
	inputConfig?: InputConfig,
): Serve {
	const config = ConfigSchema.parse(inputConfig);

	const { router, webSocketHandler } = createRouter(registry, config);

	return {
		hostname: config.hostname,
		port: config.port,
		fetch: router.fetch,
		websocket: webSocketHandler,
	};
}

export function serve(
	registry: Registry<any>,
	inputConfig: InputConfig,
): Server {
	const config = ConfigSchema.parse(inputConfig);

	const handler = createHandler(registry, config);
	const server = Bun.serve(handler);

	logger().info("rivetkit started", {
		hostname: config.hostname,
		port: config.port,
	});

	return server;
}
