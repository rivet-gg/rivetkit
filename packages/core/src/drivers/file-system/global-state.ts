import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import type { ActorKey } from "@/actor/mod";
import { logger } from "./log";
import {
	getStoragePath,
	getActorStoragePath as getActorDataPath,
	ensureDirectoryExists,
	ensureDirectoryExistsSync,
	getActorsDir,
} from "./utils";
import invariant from "invariant";
import { serializeEmptyPersistData } from "@/driver-helpers/mod";
import * as cbor from "cbor-x";

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

	constructor(customPath?: string) {
		// Set up storage directory
		this.#storagePath = getStoragePath(customPath);

		// Ensure storage directories exist synchronously during initialization
		ensureDirectoryExistsSync(getActorsDir(this.#storagePath));

		// Load all actors into cache synchronously
		this.#loadAllActorsIntoCache();

		logger().info("file system loaded", {
			dir: this.#storagePath,
			actorCount: this.#stateCache.size,
		});
	}

	/**
	 * Load all actors into the state cache from the file system
	 * Only called once during initialization
	 */
	#loadAllActorsIntoCache(): void {
		const actorsDir = getActorsDir(this.#storagePath);

		try {
			// HACK: Use synchronous filesystem operations for initialization
			const actorIds = fsSync.readdirSync(actorsDir);

			for (const actorId of actorIds) {
				const stateFilePath = getActorDataPath(this.#storagePath, actorId);

				if (fsSync.existsSync(stateFilePath)) {
					try {
						const stateData = fsSync.readFileSync(stateFilePath);
						const state = cbor.decode(stateData) as ActorState;

						this.#stateCache.set(actorId, state);
					} catch (error) {
						logger().error(
							"failed to read actor state during cache initialization",
							{ actorId, error },
						);
					}
				}
			}
		} catch (error) {
			logger().error("failed to load actors into cache", { error });
		}
	}

	/**
	 * Get the current storage directory path
	 */
	get storagePath(): string {
		return this.#storagePath;
	}

	/**
	 * Load actor state from cache
	 */
	loadActorState(actorId: string): ActorState {
		this.ensureActorExists(actorId);

		// Get actor state from cache
		const cachedActor = this.#stateCache.get(actorId);
		invariant(cachedActor, `actor state should exist in cache for ${actorId}`);

		return cachedActor;
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

		const dataPath = getActorDataPath(this.#storagePath, actorId);

		try {
			// TODO: This only needs to be done once
			// Create actor directory
			await ensureDirectoryExists(path.dirname(dataPath));

			// Write data
			const serializedState = cbor.encode(state);
			await fs.writeFile(dataPath, serializedState);
			console.log("saving state", dataPath);
		} catch (error) {
			logger().error("failed to save actor state", { actorId, error });
			throw new Error(`Failed to save actor state: ${error}`);
		}
	}

	/**
	 * Check if a actor exists in the cache
	 */
	hasActor(actorId: string): boolean {
		return this.#stateCache.has(actorId);
	}

	/**
	 * Ensure a actor exists, throwing if it doesn't
	 */
	ensureActorExists(actorId: string): void {
		if (!this.hasActor(actorId)) {
			throw new Error(`Actor does not exist for ID: ${actorId}`);
		}
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
	 * Find actor by name and key
	 */
	findActorByNameAndKey(name: string, key: ActorKey): ActorState | undefined {
		// NOTE: This is a slow implementation that checks each actor individually.
		// This can be optimized with an index in the future.

		return this.findActor((actor) => {
			if (actor.name !== name) return false;

			// If actor doesn't have a key, it's not a match
			if (!actor.key || actor.key.length !== key.length) {
				return false;
			}

			// Check if all elements in key are in actor.key
			for (let i = 0; i < key.length; i++) {
				if (key[i] !== actor.key[i]) {
					return false;
				}
			}
			return true;
		});
	}

	/**
	 * Find actor by filter function
	 */
	findActor(filter: (actor: ActorState) => boolean): ActorState | undefined {
		for (const actor of this.#stateCache.values()) {
			if (filter(actor)) {
				return actor;
			}
		}
		return undefined;
	}

	/**
	 * Get all actors from the cache
	 */
	getAllActors(): ActorState[] {
		// Return all actors from the cache
		return Array.from(this.#stateCache.values());
	}
}
