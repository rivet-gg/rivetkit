import { serve as honoServe } from "@hono/node-server";
import { createNodeWebSocket, NodeWebSocket } from "@hono/node-ws";
import { createRouter } from "@actor-core/redis";
import type { Config } from "./config";

export function serve(config: Config) {
	let injectWebSocket: NodeWebSocket['injectWebSocket'] | undefined;

	const app = createRouter(config, {
		getUpgradeWebSocket: app => {
			const nodeWs = createNodeWebSocket({ app });
			injectWebSocket = nodeWs.injectWebSocket;
			return nodeWs.upgradeWebSocket;

		},
	});
	if (!injectWebSocket) throw new Error("injectWebSocket not defined");

	const server = honoServe({
		fetch: app.fetch,
		hostname: config.server?.hostname ?? process.env.HOSTNAME,
		port: config.server?.port ?? Number.parseInt(process.env.PORT ?? "8787"),
	});

	injectWebSocket(server);
}
