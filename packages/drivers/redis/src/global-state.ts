import {
	type ActorKey,
	type AnyActorInstance,
	createGenericConnDrivers,
	GenericConnGlobalState,
	lookupInRegistry,
	type RegistryConfig,
	type RunConfig,
} from "@rivetkit/core";
import {
	type ActorDriver,
	serializeEmptyPersistData,
} from "@rivetkit/core/driver-helpers";
import * as cbor from "cbor-x";
import invariant from "invariant";
import type { Redis } from "ioredis";
import { logger } from "./log";

// Define AnyClient locally since it's not exported
type AnyClient = any;

// Actor handler to track running instances
class ActorHandler {
	/** Will be undefined if not yet loaded. */
	actor?: AnyActorInstance;
	/** Promise that will resolve when the actor is loaded. This should always be awaited before accessing the actor. */
	actorPromise?: PromiseWithResolvers<void> = Promise.withResolvers();
	genericConnGlobalState = new GenericConnGlobalState();
}

/**
 * Interface representing a actor's state
 */
export interface ActorState {
	id: string;
	name: string;
	key: ActorKey;
	persistedData: Uint8Array;
}

/**
 * Global state for the Redis driver
 */
export class RedisGlobalState {
	#redis: Redis;
	#keyPrefix: string;
	#actors = new Map<string, ActorHandler>();

	constructor(redis: Redis, keyPrefix: string = "rivetkit:") {
		this.#redis = redis;
		this.#keyPrefix = keyPrefix;

		logger().info("redis driver ready", {
			keyPrefix,
		});
	}

	/**
	 * Get Redis key for actor state
	 */
	#getActorKey(actorId: string): string {
		return `${this.#keyPrefix}actors:${actorId}`;
	}

	/**
	 * Get Redis key for actor data
	 */
	#getActorDataKey(actorId: string): string {
		return `${this.#keyPrefix}actors:${actorId}:data`;
	}

	/**
	 * Load actor state from Redis
	 */
	async loadActorState(actorId: string): Promise<ActorState> {
		const key = this.#getActorKey(actorId);
		const data = await this.#redis.get(key);

		if (!data) {
			throw new Error(`Actor does not exist for ID: ${actorId}`);
		}

		try {
			const state = cbor.decode(Buffer.from(data, "base64")) as ActorState;
			return state;
		} catch (error) {
			logger().error("failed to load actor state", { actorId, error });
			throw new Error(`Failed to load actor state: ${error}`);
		}
	}

	/**
	 * Read persisted data for a actor
	 */
	async readPersistedData(actorId: string): Promise<Uint8Array | undefined> {
		const state = await this.loadActorState(actorId);
		return state.persistedData;
	}

	/**
	 * Write persisted data for a actor
	 */
	async writePersistedData(actorId: string, data: Uint8Array): Promise<void> {
		const state = await this.loadActorState(actorId);
		state.persistedData = data;
		await this.saveActorState(actorId, state);
	}

	/**
	 * Save actor state to Redis
	 */
	async saveActorState(actorId: string, state?: ActorState): Promise<void> {
		if (!state) {
			state = await this.loadActorState(actorId);
		}

		const key = this.#getActorKey(actorId);

		try {
			const serializedState = cbor.encode(state);
			await this.#redis.set(
				key,
				Buffer.from(serializedState).toString("base64"),
			);
		} catch (error) {
			logger().error("failed to save actor state", { actorId, error });
			throw new Error(`Failed to save actor state: ${error}`);
		}
	}

	/**
	 * Check if a actor exists in Redis
	 */
	async hasActor(actorId: string): Promise<boolean> {
		const key = this.#getActorKey(actorId);
		const exists = await this.#redis.exists(key);
		return exists === 1;
	}

	/**
	 * Create a actor
	 */
	async createActor(
		actorId: string,
		name: string,
		key: ActorKey,
		input: unknown | undefined,
	): Promise<void> {
		// Check if actor already exists
		if (await this.hasActor(actorId)) {
			throw new Error(`Actor already exists for ID: ${actorId}`);
		}

		// Create initial state
		const newState: ActorState = {
			id: actorId,
			name,
			key,
			persistedData: serializeEmptyPersistData(input),
		};

		// Save to Redis
		await this.saveActorState(actorId, newState);
	}

	/**
	 * Get actor metadata
	 */
	async getActorMetadata(actorId: string): Promise<ActorState | undefined> {
		try {
			return await this.loadActorState(actorId);
		} catch {
			return undefined;
		}
	}

	async loadActor(
		registryConfig: RegistryConfig,
		runConfig: RunConfig,
		inlineClient: AnyClient,
		actorDriver: ActorDriver,
		actorId: string,
	): Promise<AnyActorInstance> {
		// Check if actor is already loaded
		let handler = this.#actors.get(actorId);
		if (handler) {
			if (handler.actorPromise) await handler.actorPromise.promise;
			if (!handler.actor) throw new Error("Actor should be loaded");
			return handler.actor;
		}

		// Create new actor
		logger().debug("creating new actor", { actorId });

		// Insert unloaded placeholder in order to prevent race conditions with multiple insertions of the actor
		handler = new ActorHandler();
		this.#actors.set(actorId, handler);

		// Get the actor metadata
		const hasActor = await this.hasActor(actorId);
		invariant(hasActor, `actor ${actorId} does not exist`);
		const { name, key } = await this.loadActorState(actorId);

		// Create actor
		const definition = lookupInRegistry(registryConfig, name);
		handler.actor = definition.instantiate();

		// Start actor
		const connDrivers = createGenericConnDrivers(
			handler.genericConnGlobalState,
		);
		await handler.actor.start(
			connDrivers,
			actorDriver,
			inlineClient,
			actorId,
			name,
			key,
			"unknown",
		);

		// Finish
		handler.actorPromise?.resolve();
		handler.actorPromise = undefined;

		return handler.actor;
	}

	getGenericConnGlobalState(actorId: string): GenericConnGlobalState {
		const handler = this.#actors.get(actorId);
		if (!handler) {
			throw new Error(`no actor for generic conn global state: ${actorId}`);
		}
		return handler.genericConnGlobalState;
	}
}
