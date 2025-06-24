import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import type { WorkerKey } from "@rivetkit/core";
import { logger } from "./log";
import {
	getStoragePath,
	getWorkerStoragePath,
	ensureDirectoryExists,
	ensureDirectoryExistsSync,
} from "./utils";
import invariant from "invariant";

/**
 * Interface representing a worker's state
 */
export interface WorkerState {
	id: string;
	name: string;
	key: WorkerKey;
	persistedData: unknown;
	input?: unknown;
}

/**
 * Global state for the file system driver
 */
export class FileSystemGlobalState {
	#storagePath: string;
	#stateCache: Map<string, WorkerState> = new Map();

	constructor(customPath?: string) {
		// Set up storage directory
		this.#storagePath = getStoragePath(customPath);

		// Ensure storage directories exist synchronously during initialization
		ensureDirectoryExistsSync(this.#storagePath);
		ensureDirectoryExistsSync(`${this.#storagePath}/workers`);

		// Load all workers into cache synchronously
		this.#loadAllWorkersIntoCache();

		logger().info("file system loaded", {
			dir: this.#storagePath,
			workerCount: this.#stateCache.size,
		});
	}

	/**
	 * Load all workers into the state cache from the file system
	 * Only called once during initialization
	 */
	#loadAllWorkersIntoCache(): void {
		const workersDir = path.join(this.#storagePath, "workers");

		try {
			// HACK: Use synchronous filesystem operations for initialization
			const workerIds = fsSync.readdirSync(workersDir);

			for (const workerId of workerIds) {
				const stateFilePath = this.getStateFilePath(workerId);

				if (fsSync.existsSync(stateFilePath)) {
					try {
						const stateData = fsSync.readFileSync(stateFilePath, "utf8");
						const state = JSON.parse(stateData) as WorkerState;

						this.#stateCache.set(workerId, state);
					} catch (error) {
						logger().error(
							"failed to read worker state during cache initialization",
							{ workerId, error },
						);
					}
				}
			}
		} catch (error) {
			logger().error("failed to load workers into cache", { error });
		}
	}

	/**
	 * Get the current storage directory path
	 */
	get storagePath(): string {
		return this.#storagePath;
	}

	/**
	 * Get state file path for a worker
	 */
	getStateFilePath(workerId: string): string {
		const workerDir = getWorkerStoragePath(this.#storagePath, workerId);
		return path.join(workerDir, "state.json");
	}

	/**
	 * Load worker state from cache
	 */
	loadWorkerState(workerId: string): WorkerState {
		this.ensureWorkerExists(workerId);

		// Get worker state from cache
		const cachedWorker = this.#stateCache.get(workerId);
		invariant(cachedWorker, `worker state should exist in cache for ${workerId}`);

		return cachedWorker;
	}

	readInput(workerId: string): unknown | undefined {
		const state = this.loadWorkerState(workerId);
		return state.input;
	}

	/**
	 * Read persisted data for a worker
	 */
	readPersistedData(workerId: string): unknown | undefined {
		const state = this.loadWorkerState(workerId);
		return state.persistedData;
	}

	/**
	 * Write persisted data for a worker
	 */
	writePersistedData(workerId: string, data: unknown): void {
		const state = this.loadWorkerState(workerId);
		state.persistedData = data;
	}

	/**
	 * Save worker state to disk
	 */
	async saveWorkerState(workerId: string): Promise<void> {
		const state = this.#stateCache.get(workerId);
		if (!state) {
			return;
		}

		const workerDir = getWorkerStoragePath(this.#storagePath, workerId);
		const stateFilePath = this.getStateFilePath(workerId);

		try {
			// Create worker directory
			await ensureDirectoryExists(workerDir);

			// Create serializable object
			// State is already in serializable format
			const serializedState = state;

			await fs.writeFile(
				stateFilePath,
				JSON.stringify(serializedState),
				"utf8",
			);
		} catch (error) {
			logger().error("failed to save worker state", { workerId, error });
			throw new Error(`Failed to save worker state: ${error}`);
		}
	}

	/**
	 * Check if a worker exists in the cache
	 */
	hasWorker(workerId: string): boolean {
		return this.#stateCache.has(workerId);
	}

	/**
	 * Ensure a worker exists, throwing if it doesn't
	 */
	ensureWorkerExists(workerId: string): void {
		if (!this.hasWorker(workerId)) {
			throw new Error(`Worker does not exist for ID: ${workerId}`);
		}
	}

	/**
	 * Create a worker
	 */
	async createWorker(
		workerId: string,
		name: string,
		key: WorkerKey,
		input?: unknown,
	): Promise<void> {
		// Check if worker already exists
		if (this.hasWorker(workerId)) {
			throw new Error(`Worker already exists for ID: ${workerId}`);
		}

		// Create initial state
		const newState: WorkerState = {
			id: workerId,
			name,
			key,
			persistedData: undefined,
			input,
		};

		// Cache the state
		this.#stateCache.set(workerId, newState);

		// Save to disk
		await this.saveWorkerState(workerId);
	}

	/**
	 * Find worker by name and key
	 */
	findWorkerByNameAndKey(name: string, key: WorkerKey): WorkerState | undefined {
		// NOTE: This is a slow implementation that checks each worker individually.
		// This can be optimized with an index in the future.

		return this.findWorker((worker) => {
			if (worker.name !== name) return false;

			// If worker doesn't have a key, it's not a match
			if (!worker.key || worker.key.length !== key.length) {
				return false;
			}

			// Check if all elements in key are in worker.key
			for (let i = 0; i < key.length; i++) {
				if (key[i] !== worker.key[i]) {
					return false;
				}
			}
			return true;
		});
	}

	/**
	 * Find worker by filter function
	 */
	findWorker(filter: (worker: WorkerState) => boolean): WorkerState | undefined {
		for (const worker of this.#stateCache.values()) {
			if (filter(worker)) {
				return worker;
			}
		}
		return undefined;
	}

	/**
	 * Get all workers from the cache
	 */
	getAllWorkers(): WorkerState[] {
		// Return all workers from the cache
		return Array.from(this.#stateCache.values());
	}
}
