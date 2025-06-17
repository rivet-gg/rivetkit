import { setupLogging } from "rivetkit/log";
import { serve as honoServe } from "@hono/node-server";
import { createNodeWebSocket, NodeWebSocket } from "@hono/node-ws";
import { logger } from "./log";
import { GetWorkerMeta, RivetManagerDriver } from "./manager-driver";
import type { RivetClientConfig } from "./rivet-client";
import { PartitionTopologyManager } from "rivetkit/topologies/partition";
import { proxy } from "hono/proxy";
import invariant from "invariant";
import { ConfigSchema, InputConfig } from "./config";
import type { Registry } from "rivetkit";
import { createWebSocketProxy } from "./ws-proxy";

export async function startManager(
	registry: Registry<any>,
	inputConfig?: InputConfig,
): Promise<void> {
	setupLogging();

	const driverConfig = ConfigSchema.parse(inputConfig);

	const portStr = process.env.PORT_HTTP;
	if (!portStr) {
		throw "Missing port";
	}
	const port = Number.parseInt(portStr);
	if (!Number.isFinite(port)) {
		throw "Invalid port";
	}

	const endpoint = process.env.RIVET_API_ENDPOINT;
	if (!endpoint) throw new Error("missing RIVET_API_ENDPOINT");
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

	// Setup manager driver
	if (!driverConfig.drivers) driverConfig.drivers = {};
	if (!driverConfig.drivers.manager) {
		driverConfig.drivers.manager = new RivetManagerDriver(clientConfig);
	}

	// Setup WebSocket routing for Node
	//
	// Save `injectWebSocket` for after server is created
	let injectWebSocket: NodeWebSocket["injectWebSocket"] | undefined;
	if (!driverConfig.getUpgradeWebSocket) {
		driverConfig.getUpgradeWebSocket = (app) => {
			const webSocket = createNodeWebSocket({ app });
			injectWebSocket = webSocket.injectWebSocket;
			return webSocket.upgradeWebSocket;
		};
	}

	// Create manager topology
	driverConfig.topology = driverConfig.topology ?? "partition";
	const managerTopology = new PartitionTopologyManager(
		registry.config,
		driverConfig,
		{
			sendRequest: async (workerId, meta, workerRequest) => {
				invariant(meta, "meta not provided");
				const workerMeta = meta as GetWorkerMeta;

				const parsedRequestUrl = new URL(workerRequest.url);
				const workerUrl = `${workerMeta.endpoint}${parsedRequestUrl.pathname}${parsedRequestUrl.search}`;

				logger().debug("proxying request to rivet worker", {
					method: workerRequest.method,
					url: workerUrl,
				});

				const proxyRequest = new Request(workerUrl, workerRequest);
				return await fetch(proxyRequest);
			},
			openWebSocket: async (workerId, meta, encodingKind) => {
				invariant(meta, "meta not provided");
				const workerMeta = meta as GetWorkerMeta;

				// Create WebSocket URL with encoding parameter
				const wsEndpoint = workerMeta.endpoint.replace(/^http/, "ws");
				const url = `${wsEndpoint}/connect/websocket?encoding=${encodingKind}&expose-internal-error=true`;

				logger().debug("opening websocket to worker", {
					workerId,
					url,
				});

				// Open WebSocket connection
				return new WebSocket(url);
			},
			proxyRequest: async (c, workerRequest, _workerId, metaRaw) => {
				invariant(metaRaw, "meta not provided");
				const meta = metaRaw as GetWorkerMeta;

				const parsedRequestUrl = new URL(workerRequest.url);
				const workerUrl = `${meta.endpoint}${parsedRequestUrl.pathname}${parsedRequestUrl.search}`;

				logger().debug("proxying request to rivet worker", {
					method: workerRequest.method,
					url: workerUrl,
				});

				const proxyRequest = new Request(workerUrl, workerRequest);
				return await proxy(proxyRequest);
			},
			proxyWebSocket: async (c, path, _workerId, metaRaw, upgradeWebSocket) => {
				invariant(metaRaw, "meta not provided");
				const meta = metaRaw as GetWorkerMeta;

				const workerUrl = `${meta.endpoint}${path}`;

				logger().debug("proxying websocket to rivet worker", {
					url: workerUrl,
				});

				const handlers = createWebSocketProxy(workerUrl);

				// upgradeWebSocket is middleware, so we need to pass fake handlers
				invariant(upgradeWebSocket, "missing upgradeWebSocket");
				return upgradeWebSocket((c) => createWebSocketProxy(workerUrl))(
					c,
					async () => {},
				);
			},
		},
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

// import { Hono } from "hono";
// import { serve } from "@hono/node-server";
// import { upgradeWebSocket } from "hono/cloudflare-workers";
// import { logger as honoLogger } from "hono/logger";
//
// export async function startManager(
// 	registry: Registry<any>,
// 	inputConfig?: InputConfig,
// ): Promise<void> {
// 	const port = parseInt(process.env.PORT_HTTP!);
//
// 	const router = new Hono();
// 	router.use(honoLogger());
//
// 	const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({
// 		app: router,
// 	});
//
// 	router.get("/", (c) => {
// 		return c.text("Hello Hono!");
// 	});
//
// 	console.log(`Server is running on port ${port}`);
//
// 	const server = serve({
// 		fetch: router.fetch,
// 		hostname: "0.0.0.0",
// 		port,
// 	});
// 	injectWebSocket(server);
//
// 	console.log(`WS injected`);
// }
