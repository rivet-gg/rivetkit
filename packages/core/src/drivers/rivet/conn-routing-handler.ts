import { logger } from "./log";
import { type RivetClientConfig } from "./rivet-client";
import { getWorkerMeta } from "./worker-meta";
import invariant from "invariant";
import { ConnRoutingHandler } from "@/worker/conn-routing-handler";
import {
	HEADER_AUTH_DATA,
	HEADER_CONN_PARAMS,
	HEADER_ENCODING,
	HEADER_EXPOSE_INTERNAL_ERROR,
} from "@/driver-helpers/mod";
import { importWebSocket } from "@/common/websocket";
import { createWebSocketProxy } from "./ws-proxy";
import { proxy } from "hono/proxy";

export function createRivetConnRoutingHandler(
	clientConfig: RivetClientConfig,
): ConnRoutingHandler {
	return {
		custom: {
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
	};
}
