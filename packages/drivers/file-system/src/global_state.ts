import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import type { ActorTags } from "actor-core";
import { logger } from "./log";
import {
	getStoragePath,
	getActorStoragePath,
	ensureDirectoryExists,
	ensureDirectoryExistsSync,
} from "./utils";
import invariant from "invariant";

/**
 * Actor state object for caching
 */
export interface ActorState {
	id: string;
	name: string;
	tags: Record<string, string>;
	kvStore: Map<string, string>;
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
			actorCount: this.#stateCache.size
		});
	}

	/**
	 * Load all actors into the state cache from the file system
	 * Only called once during initialization
	 */
	#loadAllActorsIntoCache(): void {
		const actorsDir = path.join(this.#storagePath, "actors");
		
		try {
			// Use synchronous filesystem operations for initialization
			const actorIds = fsSync.readdirSync(actorsDir);
			
			for (const actorId of actorIds) {
				const stateFilePath = this.getStateFilePath(actorId);
				
				if (fsSync.existsSync(stateFilePath)) {
					try {
						const stateData = fsSync.readFileSync(stateFilePath, "utf8");
						const rawState = JSON.parse(stateData);
						
						// Convert kvData object to kvStore Map
						const kvStore = new Map<string, string>();
						if (rawState.kvData && typeof rawState.kvData === "object") {
							for (const [key, value] of Object.entries(rawState.kvData)) {
								kvStore.set(key, value as string);
							}
						}
						
						// Create actor state with Map-based kvStore
						const state: ActorState = {
							id: rawState.id,
							name: rawState.name,
							tags: rawState.tags,
							kvStore,
						};
						
						this.#stateCache.set(actorId, state);
					} catch (error) {
						logger().error("failed to read actor state during cache initialization", { actorId, error });
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
	 * Get a value from KV store
	 */
	getKv(actorId: string, serializedKey: string): string | undefined {
		const state = this.loadActorState(actorId);
		return state.kvStore.get(serializedKey);
	}

	/**
	 * Put a value into KV store
	 */
	putKv(actorId: string, serializedKey: string, value: string): void {
		const state = this.loadActorState(actorId);
		state.kvStore.set(serializedKey, value);
	}

	/**
	 * Delete a value from KV store
	 */
	deleteKv(actorId: string, serializedKey: string): void {
		const state = this.loadActorState(actorId);
		state.kvStore.delete(serializedKey);
	}

	/**
	 * Save actor state to disk
	 */
	async saveActorState(actorId: string): Promise<void> {
		const state = this.#stateCache.get(actorId);
		if (!state) {
			return;
		}

		const stateFilePath = this.getStateFilePath(actorId);

		try {
			// Convert Map to plain object for serialization
			const kvData: Record<string, string> = {};
			for (const [key, value] of state.kvStore.entries()) {
				kvData[key] = value;
			}

			// Create serializable object
			const serializedState = {
				id: state.id,
				name: state.name,
				tags: state.tags,
				kvData
			};

			await fs.writeFile(stateFilePath, JSON.stringify(serializedState), "utf8");
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
		tags: ActorTags,
	): Promise<void> {
		// Check if actor already exists
		if (this.hasActor(actorId)) {
			throw new Error(`Actor already exists for ID: ${actorId}`);
		}

		// Create actor directory
		const actorDir = getActorStoragePath(this.#storagePath, actorId);
		await ensureDirectoryExists(actorDir);

		// Create initial state
		const newState: ActorState = {
			id: actorId,
			name,
			tags,
			kvStore: new Map(),
		};

		// Cache the state
		this.#stateCache.set(actorId, newState);

		// Save to disk
		await this.saveActorState(actorId);
	}

	/**
	 * Find an actor by name and tags from the cache
	 */
	findActor(name: string, tags: ActorTags): string | undefined {
		const serializedSearchTags = JSON.stringify(tags);

		// Search through cached actors
		for (const [actorId, state] of this.#stateCache.entries()) {
			if (
				state.name === name &&
				JSON.stringify(state.tags) === serializedSearchTags
			) {
				return actorId;
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