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
import { generateRandomString } from "@/actor/utils";
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
	getActorStatePath as getActorDataPath,
	getActorDbPath,
	getActorsDbsPath,
	getActorsDir,
	getStoragePath,
} from "./utils";

// Actor handler to track running instances

interface ActorEntry {
	id: string;

	state?: ActorState;
	/** Promise for loading the actor state. */
	loadPromise?: Promise<ActorEntry>;

	actor?: AnyActorInstance;
	/** Promise for starting the actor. */
	startPromise?: PromiseWithResolvers<void>;

	genericConnGlobalState: GenericConnGlobalState;

	/** Promise for ongoing write operations to prevent concurrent writes */
	writePromise?: Promise<void>;
}

/**
 * Interface representing a actor's state
 */
export interface ActorState {
	id: string;
	name: string;
	key: ActorKey;
	createdAt?: Date;
	persistedData: Uint8Array;
}

/**
 * Global state for the file system driver
 */
export class FileSystemGlobalState {
	#storagePath: string;
	#persist: boolean;
	#actors = new Map<string, ActorEntry>();
	#actorCountOnStartup: number = 0;

	get storagePath() {
		return this.#storagePath;
	}

	get actorCountOnStartup() {
		return this.#actorCountOnStartup;
	}

	get #actorsDir(): string {
		return getActorsDir(this.#storagePath);
	}

	get #dbsDir(): string {
		return getActorsDbsPath(this.#storagePath);
	}

	constructor(persist: boolean = true, customPath?: string) {
		this.#persist = persist;
		this.#storagePath = persist ? getStoragePath(customPath) : ":memory:";

		if (this.#persist) {
			// Ensure storage directories exist synchronously during initialization
			ensureDirectoryExistsSync(this.#actorsDir);
			ensureDirectoryExistsSync(this.#dbsDir);

			try {
				const actorIds = fsSync.readdirSync(this.#actorsDir);
				this.#actorCountOnStartup = actorIds.length;
			} catch (error) {
				logger().error("failed to count actors", { error });
			}

			logger().debug("file system driver ready", {
				dir: this.#storagePath,
				actorCount: this.#actorCountOnStartup,
			});

			// Cleanup stale temp files on startup
			try {
				this.#cleanupTempFilesSync();
			} catch (err) {
				logger().error("failed to cleanup temp files", { error: err });
			}
		} else {
			logger().debug("memory driver ready");
		}
	}

	async *getActorsIterator(params: {
		cursor?: string;
	}): AsyncGenerator<ActorState> {
		const actorIds = fsSync
			.readdirSync(this.#actorsDir)
			.filter((id) => !id.includes(".tmp"))
			.sort();
		const startIndex = params.cursor ? actorIds.indexOf(params.cursor) + 1 : 0;

		for (let i = startIndex; i < actorIds.length; i++) {
			const actorId = actorIds[i];
			if (!actorId) {
				continue;
			}

			try {
				const state = await this.loadActorStateOrError(actorId);
				yield state;
			} catch (error) {
				logger().error("failed to load actor state", { actorId, error });
			}
		}
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
			await entry.loadPromise;
			return entry;
		}

		// Start loading state
		entry.loadPromise = this.loadActorState(entry);
		return entry.loadPromise;
	}

	private async loadActorState(entry: ActorEntry) {
		const stateFilePath = getActorDataPath(this.#storagePath, entry.id);

		// Read & parse file
		try {
			const stateData = await fs.readFile(stateFilePath);
			const state = cbor.decode(stateData) as ActorState;

			const stats = await fs.stat(stateFilePath);
			state.createdAt = stats.birthtime;

			// Cache the loaded state in handler
			entry.state = state;

			return entry;
		} catch (innerError) {
			// Failed to read actor, so reset promise to retry next time
			const error = new Error(`Failed to load actor state: ${innerError}`);
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

	/**
	 * Save actor state to disk
	 */
	async writeActor(actorId: string): Promise<void> {
		if (!this.#persist) {
			return;
		}

		const entry = this.#actors.get(actorId);
		invariant(entry?.state, "missing actor state");
		const state = entry.state;

		// Get the current write promise for this actor (or resolved promise if none)
		const currentWrite = entry.writePromise || Promise.resolve();

		// Chain our write after the current one
		const newWrite = currentWrite
			.then(() => this.#performWrite(actorId, state))
			.catch((err) => {
				// Log but don't prevent future writes
				logger().error("write failed", { actorId, error: err });
				throw err;
			});

		// Update the actor's write promise
		entry.writePromise = newWrite;

		// Wait for our write to complete
		try {
			await newWrite;
		} finally {
			// Clean up if we're the last write
			if (entry.writePromise === newWrite) {
				entry.writePromise = undefined;
			}
		}
	}

	/**
	 * Perform the actual write operation with atomic writes
	 */
	async #performWrite(actorId: string, state: ActorState): Promise<void> {
		const dataPath = getActorDataPath(this.#storagePath, actorId);
		// Generate unique temp filename to prevent any race conditions
		const tempPath = `${dataPath}.tmp.${crypto.randomUUID()}`;

		try {
			// Create directory if needed
			await ensureDirectoryExists(path.dirname(dataPath));

			// Perform atomic write
			const serializedState = cbor.encode(state);
			await fs.writeFile(tempPath, serializedState);
			await fs.rename(tempPath, dataPath);
		} catch (error) {
			// Cleanup temp file on error
			try {
				await fs.unlink(tempPath);
			} catch {
				// Ignore cleanup errors
			}
			logger().error("failed to save actor state", { actorId, error });
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

	async createDatabase(actorId: string): Promise<string | undefined> {
		return getActorDbPath(this.#storagePath, actorId);
	}

	getOrCreateInspectorAccessToken(): string {
		const tokenPath = path.join(this.#storagePath, "inspector-token");
		if (fsSync.existsSync(tokenPath)) {
			return fsSync.readFileSync(tokenPath, "utf-8");
		}

		const newToken = generateRandomString();
		fsSync.writeFileSync(tokenPath, newToken);
		return newToken;
	}

	/**
	 * Cleanup stale temp files on startup (synchronous)
	 */
	#cleanupTempFilesSync(): void {
		try {
			const files = fsSync.readdirSync(this.#actorsDir);
			const tempFiles = files.filter((f) => f.includes(".tmp."));

			const oneHourAgo = Date.now() - 3600000; // 1 hour in ms

			for (const tempFile of tempFiles) {
				try {
					const fullPath = path.join(this.#actorsDir, tempFile);
					const stat = fsSync.statSync(fullPath);

					// Remove if older than 1 hour
					if (stat.mtimeMs < oneHourAgo) {
						fsSync.unlinkSync(fullPath);
						logger().info("cleaned up stale temp file", { file: tempFile });
					}
				} catch (err) {
					logger().debug("failed to cleanup temp file", {
						file: tempFile,
						error: err,
					});
				}
			}
		} catch (err) {
			logger().error("failed to read actors directory for cleanup", {
				error: err,
			});
		}
	}
}
