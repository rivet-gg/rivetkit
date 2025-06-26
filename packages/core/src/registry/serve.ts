import { getEnvUniversal } from "@/utils";
import { Hono } from "hono";
import { logger } from "./log";
import type { RunConfig } from "./run-config";

export async function crossPlatformServe(
	config: RunConfig,
	rivetKitRouter: Hono,
	userRouter: Hono | undefined,
) {
	const app = userRouter ?? new Hono();

	// Import @hono/node-server
	let serve;
	try {
		const dep = await import("@hono/node-server");
		serve = dep.serve;
	} catch (err) {
		logger().error(
			"failed to import @hono/node-server. please run 'npm install @hono/node-server @hono/node-ws'",
		);
		process.exit(1);
	}

	// Mount registry
	app.route("/registry", rivetKitRouter);

	// Import @hono/node-ws
	let createNodeWebSocket;
	try {
		const dep = await import("@hono/node-ws");
		createNodeWebSocket = dep.createNodeWebSocket;
	} catch (err) {
		logger().error(
			"failed to import @hono/node-ws. please run 'npm install @hono/node-server @hono/node-ws'",
		);
		process.exit(1);
	}

	// Inject WS
	const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({
		app,
	});

	// Update config for new WS
	config.getUpgradeWebSocket = () => upgradeWebSocket;

	// Start server
	const port = Number.parseInt(
		getEnvUniversal("PORT") ?? getEnvUniversal("PORT_HTTP") ?? "8080",
	);
	const server = serve({ fetch: app.fetch, port }, () =>
		logger().info(`listening on port ${port}`),
	);
	injectWebSocket(server);
}
