import { DurableObject } from "cloudflare:workers";
import type { ActorKey, Registry, RunConfig } from "@rivetkit/core";
import { serializeEmptyPersistData } from "@rivetkit/core/driver-helpers";
import { PartitionTopologyActor } from "@rivetkit/core/topologies/partition";
import type { ExecutionContext } from "hono";
import {
	CloudflareActorsActorDriver,
	CloudflareDurableObjectGlobalState,
} from "./actor-driver";
import { type Bindings, CF_AMBIENT_ENV } from "./handler";
import { logger } from "./log";

export const KEYS = {
	NAME: "rivetkit:name",
	KEY: "rivetkit:key",
	PERSIST_DATA: "rivetkit:data",
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
	...args: ConstructorParameters<typeof DurableObject<Bindings>>
) => DurableObject<Bindings>;

interface LoadedActor {
	actorTopology: PartitionTopologyActor;
}

export function createActorDurableObject(
	registry: Registry<any>,
	runConfig: RunConfig,
): DurableObjectConstructor {
	const globalState = new CloudflareDurableObjectGlobalState();

	/**
	 * Startup steps:
	 * 1. If not already created call `initialize`, otherwise check KV to ensure it's initialized
	 * 2. Load actor
	 * 3. Start service requests
	 */
	return class ActorHandler
		extends DurableObject<Bindings>
		implements ActorHandlerInterface
	{
		#initialized?: InitializedData;
		#initializedPromise?: PromiseWithResolvers<void>;

		#actor?: LoadedActor;

		async #loadActor(): Promise<LoadedActor> {
			// This is always called from another context using CF_AMBIENT_ENV

			// Wait for init
			if (!this.#initialized) {
				// Wait for init
				if (this.#initializedPromise) {
					await this.#initializedPromise.promise;
				} else {
					this.#initializedPromise = Promise.withResolvers();
					const res = await this.ctx.storage.get([
						KEYS.NAME,
						KEYS.KEY,
						KEYS.PERSIST_DATA,
					]);
					if (res.get(KEYS.PERSIST_DATA)) {
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

			// Configure actor driver
			runConfig.driver.actor = new CloudflareActorsActorDriver(globalState);

			const actorTopology = new PartitionTopologyActor(
				registry.config,
				runConfig,
			);

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

			return await CF_AMBIENT_ENV.run(this.env, async () => {
				await this.ctx.storage.put({
					[KEYS.NAME]: req.name,
					[KEYS.KEY]: req.key,
					[KEYS.PERSIST_DATA]: serializeEmptyPersistData(req.input),
				});
				this.#initialized = {
					name: req.name,
					key: req.key,
				};

				logger().debug("initialized actor", { key: req.key });

				// Preemptively actor so the lifecycle hooks are called
				await this.#loadActor();
			});
		}

		async fetch(request: Request): Promise<Response> {
			return await CF_AMBIENT_ENV.run(this.env, async () => {
				const { actorTopology } = await this.#loadActor();

				const ctx = this.ctx;
				return await actorTopology.router.fetch(
					request,
					this.env,
					// Implement execution context so we can wait on requests
					{
						waitUntil(promise: Promise<unknown>) {
							ctx.waitUntil(promise);
						},
						passThroughOnException() {
							// Do nothing
						},
						props: {},
					} satisfies ExecutionContext,
				);
			});
		}

		async alarm(): Promise<void> {
			return await CF_AMBIENT_ENV.run(this.env, async () => {
				const { actorTopology } = await this.#loadActor();
				await actorTopology.actor.onAlarm();
			});
		}
	};
}
