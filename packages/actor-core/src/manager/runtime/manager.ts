import { ActorsRequestSchema } from "@/manager/protocol/mod";
import { Hono, type Context as HonoContext } from "hono";
import type { ManagerDriver } from "@/actor/runtime/driver";
import { logger } from "./log";
import { type ActorTags, assertUnreachable } from "@/common/utils";
import type { BaseConfig } from "@/driver-helpers";

export class Manager {
	#config: BaseConfig;
	#driver: ManagerDriver;

	router: Hono;

	public constructor(config: BaseConfig) {
		this.#config = config;

		if (!config.drivers?.manager)
			throw new Error("config.drivers.manager is not defined.");
		this.#driver = config.drivers.manager;

		this.router = this.#buildRouter();
	}

	#buildRouter(): Hono {
		const managerApp = new Hono();

		managerApp.post("/actors", async (c: HonoContext) => {
			const { query } = ActorsRequestSchema.parse(await c.req.json());
			logger().debug("query", { query });

			const url = new URL(c.req.url);

			// Determine base URL to build endpoints from
			//
			// This is used to build actor endpoints
			let baseUrl = url.origin;
			if (this.#config.router?.basePath) {
				const basePath = this.#config.router.basePath;
				if (!basePath.startsWith("/"))
					throw new Error("config.router.basePath must start with /");
				if (basePath.endsWith("/"))
					throw new Error("config.router.basePath must not end with /");
				baseUrl += basePath;
			}

			// Get the actor from the manager
			let actorOutput: { endpoint: string };
			if ("getForId" in query) {
				const output = await this.#driver.getForId({
					origin: baseUrl,
					actorId: query.getForId.actorId,
				});
				if (!output)
					throw new Error(
						`Actor does not exist for ID: ${query.getForId.actorId}`,
					);
				actorOutput = output;
			} else if ("getOrCreateForTags" in query) {
				const tags = query.getOrCreateForTags.tags;
				if (!tags) throw new Error("Must define tags in getOrCreateForTags");

				const existingActor = await this.#driver.getWithTags({
					origin: baseUrl,
					tags: tags as ActorTags,
				});
				if (existingActor) {
					// Actor exists
					actorOutput = existingActor;
				} else {
					if (query.getOrCreateForTags.create) {
						// Create if needed
						actorOutput = await this.#driver.createActor({
							origin: baseUrl,
							...query.getOrCreateForTags.create,
						});
					} else {
						// Creation disabled
						throw new Error("Actor not found with tags or is private.");
					}
				}
			} else if ("create" in query) {
				actorOutput = await this.#driver.createActor({
					origin: baseUrl,
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

		return new Hono().route("/manager", managerApp);
	}
}
