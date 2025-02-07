import { DurableObject } from "cloudflare:workers";
import type { Actor, ActorTags } from "actor-core";
import { ActorDriver } from "actor-core/platform";
import { logger } from "./log";
import { Hono } from "hono";
import {
	createGenericActorRouter,
	createGenericConnectionDrivers,
	createGenericDriverGlobalState,
	GenericDriverGlobalState,
} from "actor-core/actor/generic";
import { upgradeWebSocket } from "@/websocket";
import { Config } from "./config";

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
	actor: Actor;
	router: Hono;
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

		#driverGlobal: GenericDriverGlobalState = createGenericDriverGlobalState();

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

			// Find actor prototype
			if (!this.#initialized) throw new Error("no initialized data");
			const actorName = this.#initialized.tags.name;
			const prototype = config.actors[actorName];
			// TODO: Handle error here gracefully by calling destroy
			if (!prototype) throw new Error(`no actor for name ${prototype}`);

			// Create actor
			const actor = new (prototype as any)() as Actor;

			// Create driver
			const driver = createActorDriver(this.ctx, this.#driverGlobal);

			// Create router
			const router = createGenericActorRouter({
				config,
				driverGlobal: this.#driverGlobal,
				actor,
				upgradeWebSocket,
			});

			// Save actor
			this.#actor = { actor, router };

			// Start actor
			await actor.__start(
				driver,
				this.ctx.id.toString(),
				this.#initialized.tags,
				"unknown",
			);

			return this.#actor;
		}

		async initialize(req: ActorInitRequest) {
			// TODO: Need to add this to a core promise that needs to be resolved before start

			await this.ctx.storage.put({
				[KEYS.STATE.INITIALIZED]: true,
				[KEYS.STATE.TAGS]: req.tags,
			});
			this.#initialized = { tags: req.tags };

			logger().debug("initialized actor", { tags: req.tags });

			// Preemptively actor so the lifecycle hooks are called
			await this.#loadActor();
		}

		async fetch(request: Request): Promise<Response> {
			const { router } = await this.#loadActor();
			return await router.fetch(request);
		}

		async alarm(): Promise<void> {
			const { actor } = await this.#loadActor();
			await actor.__onAlarm();
		}
	};
}

function serializeKey(key: any): string {
	return JSON.stringify(key);
}

//function deserializeKey(key: any): string {
//	return JSON.parse(key);
//}

function createActorDriver(
	ctx: DurableObjectState,
	driverGlobal: GenericDriverGlobalState,
): ActorDriver {
	// TODO: Use a better key serialization format
	return {
		connectionDrivers: createGenericConnectionDrivers(driverGlobal),

		async kvGet(key: any): Promise<any> {
			return await ctx.storage.get(serializeKey(key));
		},

		async kvGetBatch(keys: any[]): Promise<[any, any][]> {
			const resultMap = await ctx.storage.get(keys.map(serializeKey));
			const resultList = keys.map((key) => {
				return [key, resultMap.get(serializeKey(key))] as [any, any];
			});
			return resultList;
		},

		async kvPut(key: any, value: any): Promise<void> {
			await ctx.storage.put(serializeKey(key), value);
		},

		async kvPutBatch(keys: [any, any][]): Promise<void> {
			await ctx.storage.put(
				Object.fromEntries(keys.map(([k, v]) => [serializeKey(k), v])),
			);
		},

		async kvDelete(key: any): Promise<void> {
			await ctx.storage.delete(serializeKey(key));
		},

		async kvDeleteBatch(keys: any[]): Promise<void> {
			await ctx.storage.delete(keys.map(serializeKey));
		},

		async setAlarm(timestamp: number): Promise<void> {
			await ctx.storage.setAlarm(timestamp);
		},
	};
}
