import { serve as honoServe, type ServerType } from "@hono/node-server";
import { logger } from "./log";
import type { Registry } from "@rivetkit/core";
import { z } from "zod";
import type { Client } from "@rivetkit/core/client";
import { createNodeWebSocket, type NodeWebSocket } from "@hono/node-ws";
import { RunConfigSchema } from "@rivetkit/core/driver-helpers";
import { RegistryWorkers } from "@rivetkit/core";
import { Hono } from "hono";

const ConfigSchema = RunConfigSchema.extend({
	basePath: z.string().optional().default("/registry"),
	hostname: z
		.string()
		.optional()
		.default(process.env.HOSTNAME ?? "127.0.0.1"),
	port: z
		.number()
		.optional()
		.default(Number.parseInt(process.env.PORT ?? "6420")),
});

export type InputConfig = z.input<typeof ConfigSchema>;

export function serve<A extends RegistryWorkers>(
	registry: Registry<A>,
	inputConfig?: InputConfig,
): { server: ServerType; client: Client<Registry<A>> } {
	const runConfig = ConfigSchema.parse(inputConfig);

	// Setup WebSocket routing for Node
	//
	// Save `injectWebSocket` for after server is created
	let injectWebSocket: NodeWebSocket["injectWebSocket"] | undefined;
	if (!runConfig.getUpgradeWebSocket) {
		runConfig.getUpgradeWebSocket = (router) => {
			const webSocket = createNodeWebSocket({ app: router });
			injectWebSocket = webSocket.injectWebSocket;
			return webSocket.upgradeWebSocket;
		};
	}

	const { client, hono: rawHono } = registry.run(runConfig);

	const hono = new Hono().route(runConfig.basePath, rawHono);

	const server = honoServe({
		fetch: hono.fetch,
		hostname: runConfig.hostname,
		port: runConfig.port,
	});
	if (!injectWebSocket) throw new Error("missing injectWebSocket");
	injectWebSocket(server);

	logger().info("rivetkit started", {
		hostname: runConfig.hostname,
		port: runConfig.port,
	});

	return { server, client };
}
