import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as cbor from "cbor-x";
import invariant from "invariant";
import { lookupInRegistry } from "@/actor/definition";
import {
	createGenericConnDrivers,
	GenericConnGlobalState,
} from "@/actor/generic-conn-driver";
import type { AnyActorInstance } from "@/actor/instance";
import type { ActorKey } from "@/actor/mod";
import { ActionRequestSchema } from "@/actor/protocol/http/action";
import type { AnyClient, Client, ClientDriver } from "@/client/client";
import {
	type ActorDriver,
	serializeEmptyPersistData,
} from "@/driver-helpers/mod";
import type { RegistryConfig } from "@/registry/config";
import type { Registry } from "@/registry/mod";
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
 * Global state for the file system driver
 */
export class FileSystemGlobalState {
	#storagePath: string;
	#stateCache: Map<string, ActorState> = new Map();
	#persist: boolean;
	#actors = new Map<string, ActorHandler>();

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
	 * Load actor state from cache or disk (lazy loading)
	 */
	loadActorState(actorId: string): ActorState {
		// Check if already in cache
		const cachedActor = this.#stateCache.get(actorId);
		if (cachedActor) {
			return cachedActor;
		}

		// If not persisting, actor doesn't exist if not in cache
		if (!this.#persist) {
			throw new Error(`Actor does not exist for ID: ${actorId}`);
		}

		// Try to load from disk
		const stateFilePath = getActorDataPath(this.#storagePath, actorId);

		if (!fsSync.existsSync(stateFilePath)) {
			throw new Error(`Actor does not exist for ID: ${actorId}`);
		}

		try {
			const stateData = fsSync.readFileSync(stateFilePath);
			const state = cbor.decode(stateData) as ActorState;

			// Cache the loaded state
			this.#stateCache.set(actorId, state);

			return state;
		} catch (error) {
			logger().error("failed to load actor state", { actorId, error });
			throw new Error(`Failed to load actor state: ${error}`);
		}
	}

	/**
	 * Read persisted data for a actor
	 */
	readPersistedData(actorId: string): Uint8Array | undefined {
		const state = this.loadActorState(actorId);
		return state.persistedData;
	}

	/**
	 * Write persisted data for a actor
	 */
	writePersistedData(actorId: string, data: Uint8Array): void {
		const state = this.loadActorState(actorId);
		state.persistedData = data;
	}

	/**
	 * Save actor state to disk
	 */
	async saveActorState(actorId: string): Promise<void> {
		const state = this.#stateCache.get(actorId);
		if (!state) {
			return;
		}

		// Skip disk write if not persisting
		if (!this.#persist) {
			return;
		}

		const dataPath = getActorDataPath(this.#storagePath, actorId);

		try {
			// TODO: This only needs to be done once
			// Create actor directory
			await ensureDirectoryExists(path.dirname(dataPath));

			// Write data
			const serializedState = cbor.encode(state);
			await fs.writeFile(dataPath, serializedState);
		} catch (error) {
			logger().error("failed to save actor state", { actorId, error });
			throw new Error(`Failed to save actor state: ${error}`);
		}
	}

	/**
	 * Check if a actor exists in cache or on disk
	 */
	hasActor(actorId: string): boolean {
		// Check cache first
		if (this.#stateCache.has(actorId)) {
			return true;
		}

		// If not persisting, only check cache
		if (!this.#persist) {
			return false;
		}

		// Check if file exists on disk
		const stateFilePath = getActorDataPath(this.#storagePath, actorId);
		return fsSync.existsSync(stateFilePath);
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
		if (this.hasActor(actorId)) {
			throw new Error(`Actor already exists for ID: ${actorId}`);
		}

		// Create initial state
		const newState: ActorState = {
			id: actorId,
			name,
			key,
			persistedData: serializeEmptyPersistData(input),
		};

		// Cache the state
		this.#stateCache.set(actorId, newState);

		// Save to disk
		await this.saveActorState(actorId);
	}

	/**
	 * Get actor metadata
	 */
	getActorMetadata(actorId: string): ActorState | undefined {
		try {
			return this.loadActorState(actorId);
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
		invariant(this.hasActor(actorId), `actor ${actorId} does not exist`);
		const { name, key } = this.loadActorState(actorId);

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
		const actor = this.#actors.get(actorId);
		invariant(actor, `no actor for generic conn global state: ${actorId}`);
		return actor.genericConnGlobalState;
	}
}
