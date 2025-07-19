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
import { ActorAlreadyExists } from "@rivetkit/core/errors";
import * as cbor from "cbor-x";
import invariant from "invariant";
import type { Redis } from "ioredis";
import { logger } from "./log";

// Define AnyClient locally since it's not exported
type AnyClient = any;

// Actor entry to track running instances
interface ActorEntry {
	id: string;

	state?: ActorState;
	/** Promise for loading the actor state. */
	loadPromise?: PromiseWithResolvers<void>;

	actor?: AnyActorInstance;
	/** Promise for starting the actor. */
	startPromise?: PromiseWithResolvers<void>;

	genericConnGlobalState: GenericConnGlobalState;
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
	#actors = new Map<string, ActorEntry>();
	#alarmTimers = new Map<string, NodeJS.Timeout>();

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
	 * Ensures an entry exists for this actor.
	 *
	 * Used for #createActor and #loadActor.
	 */
	#upsertEntry(actorId: string): ActorEntry {
		let entry = this.#actors.get(actorId);
		if (entry) {
			return entry;
		}

		entry = {
			id: actorId,
			genericConnGlobalState: new GenericConnGlobalState(),
		};
		this.#actors.set(actorId, entry);
		return entry;
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
		return (await this.loadActorStateOrError(actorId)).persistedData;
	}

	/**
	 * Write persisted data for a actor
	 */
	async writePersistedData(actorId: string, data: Uint8Array): Promise<void> {
		const state = await this.loadActorStateOrError(actorId);
		state.persistedData = data;
		await this.saveActorState(actorId, state);
	}

	async loadActorStateOrError(actorId: string): Promise<ActorState> {
		const state = (await this.loadActor(actorId)).state;
		if (!state) throw new Error(`Actor does not exist: ${actorId}`);
		return state;
	}

	getActorOrError(actorId: string): ActorEntry {
		const entry = this.#actors.get(actorId);
		if (!entry) throw new Error(`No entry for actor: ${actorId}`);
		return entry;
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
	 * Creates a new actor and writes to Redis.
	 */
	async createActor(
		actorId: string,
		name: string,
		key: ActorKey,
		input: unknown | undefined,
	): Promise<ActorEntry> {
		if (this.#actors.has(actorId)) {
			throw new ActorAlreadyExists(name, key);
		}

		// Check if actor already exists in Redis
		if (await this.hasActor(actorId)) {
			throw new ActorAlreadyExists(name, key);
		}

		const entry = this.#upsertEntry(actorId);
		entry.state = {
			id: actorId,
			name,
			key,
			persistedData: serializeEmptyPersistData(input),
		};
		await this.saveActorState(actorId, entry.state);
		return entry;
	}

	/**
	 * Loads the actor from Redis or returns the existing actor entry. This will return an entry even if the actor does not actually exist.
	 */
	async loadActor(actorId: string): Promise<ActorEntry> {
		const entry = this.#upsertEntry(actorId);

		// Check if already loaded
		if (entry.state) {
			return entry;
		}

		// If state is currently being loaded, wait for it
		if (entry.loadPromise) {
			await entry.loadPromise.promise;
			return entry;
		}

		// Start loading state
		entry.loadPromise = Promise.withResolvers();

		// Check if actor exists in Redis
		const key = this.#getActorKey(actorId);
		const data = await this.#redis.get(key);

		if (!data) {
			// Actor does not exist
			entry.loadPromise.resolve(undefined);
			return entry;
		}

		// Read & parse data
		try {
			const state = cbor.decode(Buffer.from(data, "base64")) as ActorState;

			// Cache the loaded state in entry
			entry.state = state;
			entry.loadPromise.resolve();
			entry.loadPromise = undefined;

			return entry;
		} catch (innerError) {
			// Failed to read actor, so reset promise to retry next time
			const error = new Error(`Failed to load actor state: ${innerError}`);
			entry.loadPromise?.reject(error);
			entry.loadPromise = undefined;
			throw error;
		}
	}

	async loadOrCreateActor(
		actorId: string,
		name: string,
		key: ActorKey,
		input: unknown | undefined,
	): Promise<ActorEntry> {
		// Attempt to load actor
		const entry = await this.loadActor(actorId);

		// If no state for this actor, then create & write state
		if (!entry.state) {
			entry.state = {
				id: actorId,
				name,
				key,
				persistedData: serializeEmptyPersistData(input),
			};
			await this.saveActorState(actorId, entry.state);
		}
		return entry;
	}

	async startActor(
		registryConfig: RegistryConfig,
		runConfig: RunConfig,
		inlineClient: AnyClient,
		actorDriver: ActorDriver,
		actorId: string,
	): Promise<AnyActorInstance> {
		// Get the actor metadata
		const entry = await this.loadActor(actorId);
		if (!entry.state) {
			throw new Error(`Actor does exist and cannot be started: ${actorId}`);
		}

		// Actor already starting
		if (entry.startPromise) {
			await entry.startPromise.promise;
			invariant(entry.actor, "actor should have loaded");
			return entry.actor;
		}

		// Actor already loaded
		if (entry.actor) {
			return entry.actor;
		}

		// Create start promise
		entry.startPromise = Promise.withResolvers();

		try {
			// Create actor
			const definition = lookupInRegistry(registryConfig, entry.state.name);
			entry.actor = definition.instantiate();

			// Start actor
			const connDrivers = createGenericConnDrivers(
				entry.genericConnGlobalState,
			);
			await entry.actor.start(
				connDrivers,
				actorDriver,
				inlineClient,
				actorId,
				entry.state.name,
				entry.state.key,
				"unknown",
			);

			// Restore alarms for this actor
			await this.restoreAlarms(actorId, () => {
				entry.actor?.onAlarm();
			});

			// Finish
			entry.startPromise.resolve();
			entry.startPromise = undefined;

			return entry.actor;
		} catch (innerError) {
			const error = new Error(
				`Failed to start actor ${actorId}: ${innerError}`,
			);
			entry.startPromise?.reject(error);
			entry.startPromise = undefined;
			throw error;
		}
	}

	getGenericConnGlobalState(actorId: string): GenericConnGlobalState {
		return this.getActorOrError(actorId).genericConnGlobalState;
	}

	/**
	 * Set an alarm for an actor
	 */
	async setAlarm(
		actorId: string,
		timestamp: number,
		callback: () => void,
	): Promise<void> {
		// Clear any existing alarm timer for this actor
		const existingTimer = this.#alarmTimers.get(actorId);
		if (existingTimer) {
			clearTimeout(existingTimer);
			this.#alarmTimers.delete(actorId);
		}

		// Calculate delay
		const delay = Math.max(0, timestamp - Date.now());

		// Set new timer
		const timer = setTimeout(() => {
			this.#alarmTimers.delete(actorId);
			callback();
		}, delay);

		this.#alarmTimers.set(actorId, timer);

		logger().debug("alarm set", {
			actorId,
			timestamp,
			delay,
		});
	}

	/**
	 * Restore alarms for an actor after it's loaded
	 */
	async restoreAlarms(actorId: string, callback: () => void): Promise<void> {
		const handler = this.#actors.get(actorId);
		if (!handler?.actor) {
			throw new Error(`Actor ${actorId} not loaded`);
		}

		// Get the actor's persisted data to check for scheduled events
		const persistedData = await this.readPersistedData(actorId);
		if (!persistedData) {
			return;
		}

		try {
			const state = cbor.decode(persistedData) as any;
			if (state.e && state.e.length > 0) {
				// Set alarm for the next scheduled event
				const nextEvent = state.e[0];
				await this.setAlarm(actorId, nextEvent.t, callback);
			}
		} catch (error) {
			logger().error("failed to restore alarms", { actorId, error });
		}
	}
}
