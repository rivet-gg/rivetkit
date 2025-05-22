import { DurableObject } from "cloudflare:workers";
import type { ActorCoreApp, ActorKey } from "actor-core";
import { logger } from "./log";
import type { Config } from "./config";
import { PartitionTopologyActor } from "actor-core/topologies/partition";
import {
	CloudflareDurableObjectGlobalState,
	CloudflareWorkersActorDriver,
} from "./actor-driver";

export const KEYS = {
	INITIALIZED: "actor-core:initialized",
	NAME: "actor-core:name",
	KEY: "actor-core:key",
	INPUT: "actor-core:input",
	PERSISTED_DATA: "actor-core:data",
};

export interface ActorHandlerInterface extends DurableObject {
	initialize(req: ActorInitRequest): Promise<void>;
}

export interface ActorInitRequest {
	name: string;
	key: ActorKey;
	input?: unknown;
}

interface InitializedData {
	name: string;
	key: ActorKey;
}

export type DurableObjectConstructor = new (
	...args: ConstructorParameters<typeof DurableObject>
) => DurableObject;

interface LoadedActor {
	actorTopology: PartitionTopologyActor;
}

export function createActorDurableObject(
	app: ActorCoreApp<any>,
	config: Config,
): DurableObjectConstructor {
	const globalState = new CloudflareDurableObjectGlobalState();

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
						KEYS.INITIALIZED,
						KEYS.NAME,
						KEYS.KEY,
					]);
					if (res.get(KEYS.INITIALIZED)) {
						const name = res.get(KEYS.NAME) as string;
						if (!name) throw new Error("missing actor name");
						const key = res.get(KEYS.KEY) as ActorKey;
						if (!key) throw new Error("missing actor key");

						logger().debug("already initialized", { name, key });

						this.#initialized = { name, key };
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
			if (!config.drivers.actor) {
				config.drivers.actor = new CloudflareWorkersActorDriver(globalState);
			}
			const actorTopology = new PartitionTopologyActor(app.config, config);

			// Register DO with global state
			// HACK: This leaks the DO context, but DO does not provide a native way
			// of knowing when the DO shuts down. We're making a broad assumption
			// that DO will boot a new isolate frequenlty enough that this is not an issue.
			const actorId = this.ctx.id.toString();
			globalState.setDOState(actorId, { ctx: this.ctx, env: this.env });

			// Save actor
			this.#actor = {
				actorTopology,
			};

			// Start actor
			await actorTopology.start(
				actorId,
				this.#initialized.name,
				this.#initialized.key,
				// TODO:
				"unknown",
			);

			return this.#actor;
		}

		/** RPC called by the service that creates the DO to initialize it. */
		async initialize(req: ActorInitRequest) {
			// TODO: Need to add this to a core promise that needs to be resolved before start

			await this.ctx.storage.put({
				[KEYS.INITIALIZED]: true,
				[KEYS.NAME]: req.name,
				[KEYS.KEY]: req.key,
				[KEYS.INPUT]: req.input,
			});
			this.#initialized = {
				name: req.name,
				key: req.key,
			};

			logger().debug("initialized actor", { key: req.key });

			// Preemptively actor so the lifecycle hooks are called
			await this.#loadActor();
		}

		async fetch(request: Request): Promise<Response> {
			const { actorTopology } = await this.#loadActor();
			return await actorTopology.router.fetch(request);
		}

		async alarm(): Promise<void> {
			const { actorTopology } = await this.#loadActor();
			await actorTopology.actor.onAlarm();
		}
	};
}
