import { ActorsRequestSchema } from "@/manager/protocol/mod";
import { Hono, type Context as HonoContext } from "hono";
import { cors } from "hono/cors";
import type { ManagerDriver } from "@/manager/driver";
import { logger } from "./log";
import { type ActorTags, assertUnreachable } from "@/common/utils";
import { handleRouteError, handleRouteNotFound } from "@/common/router";
import { DriverConfig } from "@/driver-helpers/config";
import { AppConfig } from "@/app/config";

export class Manager {
	#appConfig: AppConfig;
	#driverConfig: DriverConfig;
	#driver: ManagerDriver;

	router: Hono;

	public constructor(appConfig: AppConfig, driverConfig: DriverConfig) {
		this.#appConfig = appConfig;
		this.#driverConfig = driverConfig;

		if (!driverConfig.drivers?.manager)
			throw new Error("config.drivers.manager is not defined.");
		this.#driver = driverConfig.drivers.manager;

		this.router = this.#buildRouter();
	}

	#buildRouter() {
		const app = new Hono();

		// Apply CORS middleware if configured
		if (this.#appConfig.cors) {
			app.use("*", cors(this.#appConfig.cors));
		}

		app.get("/", (c) => {
			return c.text(
				"This is an ActorCore server.\n\nLearn more at https://actorcore.org",
			);
		});

		app.get("/health", (c) => {
			return c.text("ok");
		});

		app.route("/manager", this.#buildManagerRouter());

		app.notFound(handleRouteNotFound);
		app.onError(handleRouteError);

		return app;
	}

	#buildManagerRouter(): Hono {
		const managerApp = new Hono();

		managerApp.post("/actors", async (c: HonoContext) => {
			const { query } = ActorsRequestSchema.parse(await c.req.json());
			logger().debug("query", { query });

			const url = new URL(c.req.url);

			// Determine base URL to build endpoints from
			//
			// This is used to build actor endpoints
			let baseUrl = url.origin;
			if (this.#appConfig.basePath) {
				const basePath = this.#appConfig.basePath;
				if (!basePath.startsWith("/"))
					throw new Error("config.basePath must start with /");
				if (basePath.endsWith("/"))
					throw new Error("config.basePath must not end with /");
				baseUrl += basePath;
			}

			// Get the actor from the manager
			let actorOutput: { endpoint: string };
			if ("getForId" in query) {
				const output = await this.#driver.getForId({
					c,
					baseUrl: baseUrl,
					actorId: query.getForId.actorId,
				});
				if (!output)
					throw new Error(
						`Actor does not exist for ID: ${query.getForId.actorId}`,
					);
				actorOutput = output;
			} else if ("getOrCreateForTags" in query) {
				const existingActor = await this.#driver.getWithTags({
					c,
					baseUrl: baseUrl,
					name: query.getOrCreateForTags.name,
					tags: query.getOrCreateForTags.tags
				});
				if (existingActor) {
					// Actor exists
					actorOutput = existingActor;
				} else {
					if (query.getOrCreateForTags.create) {
						// Create if needed
						actorOutput = await this.#driver.createActor({
							c,
							baseUrl: baseUrl,
							...query.getOrCreateForTags.create,
						});
					} else {
						// Creation disabled
						throw new Error("Actor not found with tags or is private.");
					}
				}
			} else if ("create" in query) {
				actorOutput = await this.#driver.createActor({
					c,
					baseUrl: baseUrl,
					...query.create,
				});
			} else {
				assertUnreachable(query);
			}

			return c.json({
				endpoint: actorOutput.endpoint,
				supportedTransports: ["websocket", "sse"],
			});
		});

		return managerApp;
	}
}
