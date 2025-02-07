import { setupLogging } from "actor-core/log";
import { Manager } from "actor-core/platform";
import type { ActorContext } from "@rivet-gg/actor-core";
import { logger } from "./log";
import { buildManager } from "./manager";
import type { RivetClientConfig } from "./rivet_client";
import type { RivetHandler } from "./util";

export function createManagerHandler(): RivetHandler {
	const handler = {
		async start(ctx: ActorContext): Promise<void> {
			setupLogging();

			const portStr = Deno.env.get("PORT_HTTP");
			if (!portStr) {
				throw "Missing port";
			}
			const port = Number.parseInt(portStr);
			if (!Number.isFinite(port)) {
				throw "Invalid port";
			}

			const endpoint = Deno.env.get("RIVET_API_ENDPOINT");
			if (!endpoint) throw new Error("missing RIVET_API_ENDPOINT");
			const token = Deno.env.get("RIVET_SERVICE_TOKEN");
			if (!token) throw new Error("missing RIVET_SERVICE_TOKEN");

			const clientConfig: RivetClientConfig = {
				endpoint,
				token,
				project: ctx.metadata.project.slug,
				environment: ctx.metadata.environment.slug,
			};

			const manager = new Manager(buildManager(clientConfig));

			const app = manager.router;

			app.all("*", (c) => {
				return c.text("Not Found (ActorCore)", 404);
			});

			logger().info("server running", { port });
			const server = Deno.serve(
				{
					port,
					hostname: "0.0.0.0",
					// Remove "Listening on ..." message
					onListen() {},
				},
				app.fetch,
			);
			await server.finished;
		},
	} satisfies RivetHandler;

	return handler;
}
