import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as cbor from "cbor-x";
import invariant from "invariant";
import { lookupInRegistry } from "@/actor/definition";
import { ActorAlreadyExists } from "@/actor/errors";
import {
	createGenericConnDrivers,
	GenericConnGlobalState,
} from "@/actor/generic-conn-driver";
import type { AnyActorInstance } from "@/actor/instance";
import type { ActorKey } from "@/actor/mod";
import type { AnyClient } from "@/client/client";
import {
	type ActorDriver,
	serializeEmptyPersistData,
} from "@/driver-helpers/mod";
import type { RegistryConfig } from "@/registry/config";
import type { RunConfig } from "@/registry/run-config";
import { logger } from "./log";
import {
	ensureDirectoryExists,
	ensureDirectoryExistsSync,
	getActorStoragePath as getActorDataPath,
	getActorsDir,
	getStoragePath,
} from "./utils";

// Actor handler to track running instances

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
 * Global state for the file system driver
 */
export class FileSystemGlobalState {
	#storagePath: string;
	#persist: boolean;
	#actors = new Map<string, ActorEntry>();

	constructor(persist: boolean = true, customPath?: string) {
		this.#persist = persist;
		this.#storagePath = persist ? getStoragePath(customPath) : ":memory:";

		if (this.#persist) {
			// Ensure storage directories exist synchronously during initialization
			ensureDirectoryExistsSync(getActorsDir(this.#storagePath));

			const actorsDir = getActorsDir(this.#storagePath);
			let actorCount = 0;

			try {
				const actorIds = fsSync.readdirSync(actorsDir);
				actorCount = actorIds.length;
			} catch (error) {
				logger().error("failed to count actors", { error });
			}

			logger().info("file system driver ready", {
				dir: this.#storagePath,
				actorCount,
			});
		} else {
			logger().info("memory driver ready");
		}
	}

	/**
	 * Get the current storage directory path
	 */
	get storagePath(): string {
		return this.#storagePath;
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
	 * Creates a new actor and writes to file system.
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

		const entry = this.#upsertEntry(actorId);
		entry.state = {
			id: actorId,
			name,
			key,
			persistedData: serializeEmptyPersistData(input),
		};
		await this.writeActor(actorId);
		return entry;
	}

	/**
	 * Loads the actor from disk or returns the existing actor entry. This will return an entry even if the actor does not actually exist.
	 */
	async loadActor(actorId: string): Promise<ActorEntry> {
		const entry = this.#upsertEntry(actorId);

		// Check if already loaded
		if (entry.state) {
			return entry;
		}

		// If not persisted, then don't load from FS
		if (!this.#persist) {
			return entry;
		}

		// If state is currently being loaded, wait for it
		if (entry.loadPromise) {
			await entry.loadPromise.promise;
			return entry;
		}

		// Start loading state
		entry.loadPromise = Promise.withResolvers();

		const stateFilePath = getActorDataPath(this.#storagePath, entry.id);

		// Check if file exists
		try {
			await fs.access(stateFilePath);
		} catch {
			// Actor does not exist
			entry.loadPromise.resolve(undefined);
			return entry;
		}

		// Read & parse file
		try {
			const stateData = await fs.readFile(stateFilePath);
			const state = cbor.decode(stateData) as ActorState;

			// Cache the loaded state in handler
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
			await this.writeActor(actorId);
		}
		return entry;
	}

	/** Writes actor state to file system. */
	async writeActor(actorId: string) {
		const handler = this.#actors.get(actorId);
		if (!handler?.state) {
			return;
		}

		// Skip fs write if not persisting
		if (!this.#persist) {
			return;
		}

		const dataPath = getActorDataPath(this.#storagePath, actorId);

		try {
			// TODO: This only needs to be done once
			// Create actor directory
			await ensureDirectoryExists(path.dirname(dataPath));

			// Write data
			const serializedState = cbor.encode(handler.state);
			await fs.writeFile(dataPath, serializedState);
		} catch (error) {
			throw new Error(`Failed to save actor state: ${error}`);
		}
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
}
