import { proxy } from "hono/proxy";
import invariant from "invariant";
import type { ConnRoutingHandler } from "@/actor/conn-routing-handler";
import { importWebSocket } from "@/common/websocket";
import {
	HEADER_AUTH_DATA,
	HEADER_CONN_PARAMS,
	HEADER_ENCODING,
	HEADER_EXPOSE_INTERNAL_ERROR,
} from "@/driver-helpers/mod";
import { getActorMeta } from "./actor-meta";
import { logger } from "./log";
import type { RivetClientConfig } from "./rivet-client";
import { createWebSocketProxy } from "./ws-proxy";

export function createRivetConnRoutingHandler(
	clientConfig: RivetClientConfig,
): ConnRoutingHandler {
	return {
		custom: {
			sendRequest: async (actorId, actorRequest) => {
				const meta = await getActorMeta(clientConfig, actorId);
				invariant(meta, "actor should exist");

				const parsedRequestUrl = new URL(actorRequest.url);
				const actorUrl = `${meta.endpoint}${parsedRequestUrl.pathname}${parsedRequestUrl.search}`;

				logger().debug("proxying request to rivet actor", {
					method: actorRequest.method,
					url: actorUrl,
				});

				const proxyRequest = new Request(actorUrl, actorRequest);
				return await fetch(proxyRequest);
			},
			openWebSocket: async (actorId, encodingKind, params: unknown) => {
				const WebSocket = await importWebSocket();

				const meta = await getActorMeta(clientConfig, actorId);
				invariant(meta, "actor should exist");

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

				logger().debug("opening websocket to actor", {
					actorId,
					url,
				});

				return new WebSocket(url, { headers });
			},
			proxyRequest: async (c, actorRequest, actorId) => {
				const meta = await getActorMeta(clientConfig, actorId);
				invariant(meta, "actor should exist");

				const parsedRequestUrl = new URL(actorRequest.url);
				const actorUrl = `${meta.endpoint}${parsedRequestUrl.pathname}${parsedRequestUrl.search}`;

				logger().debug("proxying request to rivet actor", {
					method: actorRequest.method,
					url: actorUrl,
				});

				const proxyRequest = new Request(actorUrl, actorRequest);
				return await proxy(proxyRequest);
			},
			proxyWebSocket: async (
				c,
				path,
				actorId,
				encoding,
				connParmas,
				authData,
				upgradeWebSocket,
			) => {
				const meta = await getActorMeta(clientConfig, actorId);
				invariant(meta, "actor should exist");

				const actorUrl = `${meta.endpoint}${path}`;

				logger().debug("proxying websocket to rivet actor", {
					url: actorUrl,
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

				const handlers = await createWebSocketProxy(actorUrl, headers);

				// upgradeWebSocket is middleware, so we need to pass fake handlers
				invariant(upgradeWebSocket, "missing upgradeWebSocket");
				return upgradeWebSocket((c) => handlers)(c, async () => {});
			},
		},
	};
}
