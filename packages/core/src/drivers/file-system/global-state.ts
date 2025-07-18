import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as cbor from "cbor-x";
import type { ActorKey } from "@/actor/mod";
import { serializeEmptyPersistData } from "@/driver-helpers/mod";
import { logger } from "./log";
import {
	ensureDirectoryExists,
	ensureDirectoryExistsSync,
	getActorStoragePath as getActorDataPath,
	getActorsDir,
	getStoragePath,
} from "./utils";

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

		const actorsDir = getActorsDir(this.#storagePath);
		let actorCount = 0;

		try {
			const actorIds = fsSync.readdirSync(actorsDir);
			actorCount = actorIds.length;
		} catch (error) {
			logger().error("failed to count actors", { error });
		}

		logger().info("file system loaded", {
			dir: this.#storagePath,
			actorCount,
		});
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
}
