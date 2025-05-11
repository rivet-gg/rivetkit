import { ActorsRequestSchema } from "@/manager/protocol/mod";
import { Hono, type Context as HonoContext } from "hono";
import { cors } from "hono/cors";
import { logger } from "./log";
import { assertUnreachable } from "@/common/utils";
import { handleRouteError, handleRouteNotFound } from "@/common/router";
import type { DriverConfig } from "@/driver-helpers/config";
import type { AppConfig } from "@/app/config";
import {
	createManagerInspectorRouter,
	type ManagerInspectorConnHandler,
} from "@/inspector/manager";
import type { UpgradeWebSocket } from "hono/ws";

type ManagerRouterHandler = {
	onConnectInspector?: ManagerInspectorConnHandler;
	upgradeWebSocket?: UpgradeWebSocket;
};

export function createManagerRouter(
	appConfig: AppConfig,
	driverConfig: DriverConfig,
	handler: ManagerRouterHandler,
) {
	if (!driverConfig.drivers?.manager) {
		// FIXME move to config schema
		throw new Error("config.drivers.manager is not defined.");
	}
	const driver = driverConfig.drivers.manager;
	const app = new Hono();

	// Apply CORS middleware if configured
	if (appConfig.cors) {
		app.use("*", cors(appConfig.cors));
	}

	app.get("/", (c) => {
		return c.text(
			"This is an ActorCore server.\n\nLearn more at https://actorcore.org",
		);
	});

	app.get("/health", (c) => {
		return c.text("ok");
	});

	app.post("/manager/actors", async (c: HonoContext) => {
		const { query } = ActorsRequestSchema.parse(await c.req.json());
		logger().debug("query", { query });

		const url = new URL(c.req.url);

		// Determine base URL to build endpoints from
		//
		// This is used to build actor endpoints
		let baseUrl = url.origin;
		if (appConfig.basePath) {
			const basePath = appConfig.basePath;
			if (!basePath.startsWith("/"))
				throw new Error("config.basePath must start with /");
			if (basePath.endsWith("/"))
				throw new Error("config.basePath must not end with /");
			baseUrl += basePath;
		}

		// Get the actor from the manager
		let actorOutput: { endpoint: string };
		if ("getForId" in query) {
			const output = await driver.getForId({
				c,
				baseUrl: baseUrl,
				actorId: query.getForId.actorId,
			});
			if (!output)
				throw new Error(
					`Actor does not exist for ID: ${query.getForId.actorId}`,
				);
			actorOutput = output;
		} else if ("getForKey" in query) {
			const existingActor = await driver.getWithKey({
				c,
				baseUrl: baseUrl,
				name: query.getForKey.name,
				key: query.getForKey.key,
			});
			if (!existingActor) {
				throw new Error("Actor not found with key.");
			}
			actorOutput = existingActor;
		} else if ("getOrCreateForKey" in query) {
			const existingActor = await driver.getWithKey({
				c,
				baseUrl: baseUrl,
				name: query.getOrCreateForKey.name,
				key: query.getOrCreateForKey.key,
			});
			if (existingActor) {
				// Actor exists
				actorOutput = existingActor;
			} else {
				// Create if needed
				actorOutput = await driver.createActor({
					c,
					baseUrl: baseUrl,
					name: query.getOrCreateForKey.name,
					key: query.getOrCreateForKey.key,
					region: query.getOrCreateForKey.region,
				});
			}
		} else if ("create" in query) {
			actorOutput = await driver.createActor({
				c,
				baseUrl: baseUrl,
				name: query.create.name,
				key: query.create.key,
				region: query.create.region,
			});
		} else {
			assertUnreachable(query);
		}

		return c.json({
			endpoint: actorOutput.endpoint,
			supportedTransports: ["websocket", "sse"],
		});
	});

	if (appConfig.inspector.enabled) {
		app.route(
			"/manager/inspect",
			createManagerInspectorRouter(
				handler.upgradeWebSocket,
				handler.onConnectInspector,
				appConfig.inspector,
			),
		);
	}

	app.notFound(handleRouteNotFound);
	app.onError(handleRouteError);

	return app;
}