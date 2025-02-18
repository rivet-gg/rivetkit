import { DurableObject } from "cloudflare:workers";
import type { ActorTags } from "actor-core";
import { logger } from "./log";
import { Config } from "./config";
import { PartitionTopologyActor } from "actor-core/topologies/partition";
import { CloudflareWorkersActorDriver } from "./actor_driver";
import { Hono } from "hono";
import { upgradeWebSocket } from "./websocket";

const KEYS = {
	STATE: {
		INITIALIZED: "actor:state:initialized",
		TAGS: "actor:state:tags",
	},
};

export interface ActorHandlerInterface extends DurableObject {
	initialize(req: ActorInitRequest): Promise<void>;
}

export interface ActorInitRequest {
	tags: ActorTags;
}

interface InitializedData {
	tags: ActorTags;
}

export type DurableObjectConstructor = new (
	...args: ConstructorParameters<typeof DurableObject>
) => DurableObject;

interface LoadedActor {
	actorTopology: PartitionTopologyActor;
}

export function createActorDurableObject(
	config: Config,
): DurableObjectConstructor {
	/**
	 * Startup steps:
	 * 1. If not already created call `initialize`, otherwise check KV to ensure it's initialized
	 * 2. Load actor
	 * 3. Start service requests
	 */
	return class ActorHandler
		extends DurableObject
		implements ActorHandlerInterface
	{
		#initialized?: InitializedData;
		#initializedPromise?: PromiseWithResolvers<void>;

		#actor?: LoadedActor;

		async #loadActor(): Promise<LoadedActor> {
			// Wait for init
			if (!this.#initialized) {
				// Wait for init
				if (this.#initializedPromise) {
					await this.#initializedPromise.promise;
				} else {
					this.#initializedPromise = Promise.withResolvers();
					const res = await this.ctx.storage.get([
						KEYS.STATE.INITIALIZED,
						KEYS.STATE.TAGS,
					]);
					if (res.get(KEYS.STATE.INITIALIZED)) {
						const tags = res.get(KEYS.STATE.TAGS) as ActorTags;
						if (!tags) throw new Error("missing actor tags");

						logger().debug("already initialized", { tags });

						this.#initialized = { tags };
						this.#initializedPromise.resolve();
					} else {
						logger().debug("waiting to initialize");
					}
				}
			}

			// Check if already loaded
			if (this.#actor) {
				return this.#actor;
			}

			if (!this.#initialized) throw new Error("Not initialized");

			// Create topology
			if (!config.drivers) config.drivers = {};
			if (!config.drivers.actor)
				config.drivers.actor = new CloudflareWorkersActorDriver(this.ctx);
			if (!config.router) config.router = {};
			if (!config.router.getUpgradeWebSocket)
				config.router.getUpgradeWebSocket = () => upgradeWebSocket;
			const actorTopology = new PartitionTopologyActor(config);

			// Save actor
			this.#actor = {
				actorTopology,
			};

			// Start actor
			await actorTopology.start(
				this.ctx.id.toString(),
				this.#initialized.tags,
				// TODO:
				"unknown",
			);

			return this.#actor;
		}

		/** RPC called by the service that creates the DO to initialize it. */
		async initialize(req: ActorInitRequest) {
			// TODO: Need to add this to a core promise that needs to be resolved before start

			await this.ctx.storage.put({
				[KEYS.STATE.INITIALIZED]: true,
				[KEYS.STATE.TAGS]: req.tags,
			});
			this.#initialized = {
				tags: req.tags,
			};

			logger().debug("initialized actor", { tags: req.tags });

			// Preemptively actor so the lifecycle hooks are called
			await this.#loadActor();
		}

		async fetch(request: Request): Promise<Response> {
			const { actorTopology } = await this.#loadActor();
			return await actorTopology.router.fetch(request);
		}

		async alarm(): Promise<void> {
			const { actorTopology } = await this.#loadActor();
			await actorTopology.actor.__onAlarm();
		}
	};
}
