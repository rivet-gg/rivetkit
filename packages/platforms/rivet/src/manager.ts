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
import { flushCache, getWorkerMeta } from "./worker-meta";
import {
	HEADER_AUTH_DATA,
	HEADER_CONN_PARAMS,
	HEADER_ENCODING,
	HEADER_EXPOSE_INTERNAL_ERROR,
} from "rivetkit/driver-helpers";
import { importWebSocket } from "rivetkit/driver-helpers/websocket";

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
			sendRequest: async (workerId, workerRequest) => {
				const meta = await getWorkerMeta(clientConfig, workerId);
				invariant(meta, "worker should exist");

				const parsedRequestUrl = new URL(workerRequest.url);
				const workerUrl = `${meta.endpoint}${parsedRequestUrl.pathname}${parsedRequestUrl.search}`;

				logger().debug("proxying request to rivet worker", {
					method: workerRequest.method,
					url: workerUrl,
				});

				const proxyRequest = new Request(workerUrl, workerRequest);
				return await fetch(proxyRequest);
			},
			openWebSocket: async (workerId, encodingKind, params: unknown) => {
				const WebSocket = await importWebSocket();

				const meta = await getWorkerMeta(clientConfig, workerId);
				invariant(meta, "worker should exist");

				const wsEndpoint = meta.endpoint.replace(/^http/, "ws");
				const url = `${wsEndpoint}/connect/websocket`;

				const headers: Record<string, string> = {
					Upgrade: "websocket",
					Connection: "Upgrade",
					[HEADER_EXPOSE_INTERNAL_ERROR]: "true",
					[HEADER_ENCODING]: encodingKind,
				};
				if (params) {
					headers[HEADER_CONN_PARAMS] = JSON.stringify(params);
				}

				logger().debug("opening websocket to worker", {
					workerId,
					url,
				});

				return new WebSocket(url, { headers });
			},
			proxyRequest: async (c, workerRequest, workerId) => {
				const meta = await getWorkerMeta(clientConfig, workerId);
				invariant(meta, "worker should exist");

				const parsedRequestUrl = new URL(workerRequest.url);
				const workerUrl = `${meta.endpoint}${parsedRequestUrl.pathname}${parsedRequestUrl.search}`;

				logger().debug("proxying request to rivet worker", {
					method: workerRequest.method,
					url: workerUrl,
				});

				const proxyRequest = new Request(workerUrl, workerRequest);
				return await proxy(proxyRequest);
			},
			proxyWebSocket: async (
				c,
				path,
				workerId,
				encoding,
				connParmas,
				authData,
				upgradeWebSocket,
			) => {
				const meta = await getWorkerMeta(clientConfig, workerId);
				invariant(meta, "worker should exist");

				const workerUrl = `${meta.endpoint}${path}`;

				logger().debug("proxying websocket to rivet worker", {
					url: workerUrl,
				});

				// Build headers
				const headers: Record<string, string> = {
					[HEADER_EXPOSE_INTERNAL_ERROR]: "true",
					[HEADER_ENCODING]: encoding,
				};
				if (connParmas) {
					headers[HEADER_CONN_PARAMS] = JSON.stringify(connParmas);
				}
				if (authData) {
					headers[HEADER_AUTH_DATA] = JSON.stringify(authData);
				}

				const handlers = await createWebSocketProxy(workerUrl, headers);

				// upgradeWebSocket is middleware, so we need to pass fake handlers
				invariant(upgradeWebSocket, "missing upgradeWebSocket");
				return upgradeWebSocket((c) => handlers)(c, async () => {});
			},
		},
	);

	// HACK: Expose endpoint for tests to flush cache
	managerTopology.router.post("/.test/rivet/flush-cache", (c) => {
		flushCache();
		return c.text("ok");
	});

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
