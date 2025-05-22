import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import type { ActorKey } from "actor-core";
import { logger } from "./log";
import {
	getStoragePath,
	getActorStoragePath,
	ensureDirectoryExists,
	ensureDirectoryExistsSync,
} from "./utils";
import invariant from "invariant";

/**
 * Interface representing an actor's state
 */
export interface ActorState {
	id: string;
	name: string;
	key: ActorKey;
	persistedData: unknown;
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
		ensureDirectoryExistsSync(this.#storagePath);
		ensureDirectoryExistsSync(`${this.#storagePath}/actors`);

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
		const actorsDir = path.join(this.#storagePath, "actors");

		try {
			// HACK: Use synchronous filesystem operations for initialization
			const actorIds = fsSync.readdirSync(actorsDir);

			for (const actorId of actorIds) {
				const stateFilePath = this.getStateFilePath(actorId);

				if (fsSync.existsSync(stateFilePath)) {
					try {
						const stateData = fsSync.readFileSync(stateFilePath, "utf8");
						const state = JSON.parse(stateData) as ActorState;

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
	 * Get state file path for an actor
	 */
	getStateFilePath(actorId: string): string {
		const actorDir = getActorStoragePath(this.#storagePath, actorId);
		return path.join(actorDir, "state.json");
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
	 * Read persisted data for an actor
	 */
	readPersistedData(actorId: string): unknown | undefined {
		const state = this.loadActorState(actorId);
		return state.persistedData;
	}

	/**
	 * Write persisted data for an actor
	 */
	writePersistedData(actorId: string, data: unknown): void {
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

		const actorDir = getActorStoragePath(this.#storagePath, actorId);
		const stateFilePath = this.getStateFilePath(actorId);

		try {
			// Create actor directory
			await ensureDirectoryExists(actorDir);

			// Create serializable object
			// State is already in serializable format
			const serializedState = state;

			await fs.writeFile(
				stateFilePath,
				JSON.stringify(serializedState),
				"utf8",
			);
		} catch (error) {
			logger().error("failed to save actor state", { actorId, error });
			throw new Error(`Failed to save actor state: ${error}`);
		}
	}

	/**
	 * Check if an actor exists in the cache
	 */
	hasActor(actorId: string): boolean {
		return this.#stateCache.has(actorId);
	}

	/**
	 * Ensure an actor exists, throwing if it doesn't
	 */
	ensureActorExists(actorId: string): void {
		if (!this.hasActor(actorId)) {
			throw new Error(`Actor does not exist for ID: ${actorId}`);
		}
	}

	/**
	 * Create an actor
	 */
	async createActor(
		actorId: string,
		name: string,
		key: ActorKey,
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
			persistedData: undefined
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
