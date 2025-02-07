import type { Serve, Server, ServerWebSocket, WebSocketHandler } from "bun";
import { createRouter } from "@actor-core/redis";
import type { Config } from "./config";
import { createBunWebSocket } from "hono/bun";

export function createHandler(config: Config): Serve {
	const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket>();

	const app = createRouter(config, {
		getUpgradeWebSocket: () => upgradeWebSocket,
	});

	return {
		hostname: config.server?.hostname ?? process.env.HOSTNAME,
		port: config.server?.port ?? Number.parseInt(process.env.PORT ?? "8787"),
		fetch: app.fetch,
		// HACK: Hono BunWebSocketHandler type is not compatible with Bun's
		websocket: websocket as unknown as WebSocketHandler,
	};
}

export function serve(config: Config): Server {
	return Bun.serve(createHandler(config));
}
