import { Hono } from "hono";
import { getEnvUniversal } from "@/utils";
import { logger } from "./log";

export async function crossPlatformServe(
	rivetKitRouter: Hono<any>,
	userRouter: Hono | undefined,
) {
	const app = userRouter ?? new Hono();

	// Import @hono/node-server
	let serve: any;
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
	let createNodeWebSocket: any;
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

	// Start server
	const port = Number.parseInt(
		getEnvUniversal("PORT") ?? getEnvUniversal("PORT_HTTP") ?? "8080",
	);
	const server = serve({ fetch: app.fetch, port }, () =>
		logger().info(`listening on port ${port}`),
	);
	injectWebSocket(server);

	return { upgradeWebSocket };
}
