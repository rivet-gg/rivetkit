import * as crypto from "node:crypto";
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
import {
	type LongTimeoutHandle,
	SinglePromiseQueue,
	setLongTimeout,
	stringifyError,
} from "@/utils";
import { logger } from "./log";
import {
	ensureDirectoryExists,
	ensureDirectoryExistsSync,
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

	alarmTimeout?: LongTimeoutHandle;
	/** The timestamp currently scheduled for this actor's alarm (ms since epoch). */
	alarmTimestamp?: number;

	/** Resolver for pending write operations that need to be notified when any write completes */
	pendingWriteResolver?: PromiseWithResolvers<void>;

	/** If the actor has been removed by destroy or sleep. */
	removed: boolean;
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
	#stateDir: string;
	#dbsDir: string;
	#alarmsDir: string;

	#persist: boolean;
	#actors = new Map<string, ActorEntry>();
	#actorCountOnStartup: number = 0;

	#runnerParams?: {
		registryConfig: RegistryConfig;
		runConfig: RunConfig;
		inlineClient: AnyClient;
		actorDriver: ActorDriver;
	};

	get storagePath() {
		return this.#storagePath;
	}

	get actorCountOnStartup() {
		return this.#actorCountOnStartup;
	}

	constructor(persist: boolean = true, customPath?: string) {
		this.#persist = persist;
		this.#storagePath = persist ? getStoragePath(customPath) : "/tmp";
		this.#stateDir = path.join(this.#storagePath, "state");
		this.#dbsDir = path.join(this.#storagePath, "databases");
		this.#alarmsDir = path.join(this.#storagePath, "alarms");

		if (this.#persist) {
			// Ensure storage directories exist synchronously during initialization
			ensureDirectoryExistsSync(this.#stateDir);
			ensureDirectoryExistsSync(this.#dbsDir);
			ensureDirectoryExistsSync(this.#alarmsDir);

			try {
				const actorIds = fsSync.readdirSync(this.#stateDir);
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

	getActorStatePath(actorId: string): string {
		return path.join(this.#stateDir, actorId);
	}

	getActorDbPath(actorId: string): string {
		return path.join(this.#dbsDir, `${actorId}.db`);
	}

	getActorAlarmPath(actorId: string): string {
		return path.join(this.#alarmsDir, actorId);
	}

	async *getActorsIterator(params: {
		cursor?: string;
	}): AsyncGenerator<ActorState> {
		let actorIds = Array.from(this.#actors.keys()).sort();

		// Check if state directory exists first
		if (fsSync.existsSync(this.#stateDir)) {
			actorIds = fsSync
				.readdirSync(this.#stateDir)
				.filter((id) => !id.includes(".tmp"))
				.sort();
		}

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
			removed: false,
			stateWriteQueue: new SinglePromiseQueue(),
			alarmWriteQueue: new SinglePromiseQueue(),
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
		// TODO: Does not check if actor already exists on fs

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
		await this.writeActor(actorId, entry.state);
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
		const stateFilePath = this.getActorStatePath(entry.id);

		// Read & parse file
		try {
			const stateData = await fs.readFile(stateFilePath);
			const state = cbor.decode(stateData) as ActorState;

			const stats = await fs.stat(stateFilePath);
			state.createdAt = stats.birthtime;

			// Cache the loaded state in handler
			entry.state = state;

			return entry;
		} catch (innerError: any) {
			// File does not exist, meaning the actor does not exist
			if (innerError.code === "ENOENT") {
				entry.loadPromise = undefined;
				return entry;
			}

			// For other errors, throw
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
			await this.writeActor(actorId, entry.state);
		}
		return entry;
	}

	async sleepActor(actorId: string) {
		invariant(
			this.#persist,
			"cannot sleep actor with memory driver, must use file system driver",
		);

		const actor = this.#actors.get(actorId);
		invariant(actor, `tried to sleep ${actorId}, does not exist`);

		// Wait for actor to fully start before stopping it to avoid race conditions
		if (actor.loadPromise) await actor.loadPromise.catch();
		if (actor.startPromise?.promise) await actor.startPromise.promise.catch();
		if (actor.stateWriteQueue.runningDrainLoop)
			await actor.stateWriteQueue.runningDrainLoop.catch();

		// Mark as removed
		actor.removed = true;

		// Stop actor
		invariant(actor.actor, "actor should be loaded");
		await actor.actor._stop();

		// Remove from map after stop is complete
		this.#actors.delete(actorId);
	}

	/**
	 * Save actor state to disk.
	 */
	async writeActor(actorId: string, state: ActorState): Promise<void> {
		if (!this.#persist) {
			return;
		}

		const entry = this.#actors.get(actorId);
		invariant(entry, "actor entry does not exist");

		await this.#performWrite(actorId, state);
	}

	async setActorAlarm(actorId: string, timestamp: number) {
		const entry = this.#actors.get(actorId);
		invariant(entry, "actor entry does not exist");

		// Persist alarm to disk
		if (this.#persist) {
			const alarmPath = this.getActorAlarmPath(actorId);
			const tempPath = `${alarmPath}.tmp.${crypto.randomUUID()}`;
			try {
				await ensureDirectoryExists(path.dirname(alarmPath));
				const data = cbor.encode(timestamp);
				await fs.writeFile(tempPath, data);
				await fs.rename(tempPath, alarmPath);
			} catch (error) {
				try {
					await fs.unlink(tempPath);
				} catch {}
				logger().error("failed to write alarm", { actorId, error });
				throw new Error(`Failed to write alarm: ${error}`);
			}
		}

		// Schedule timeout
		this.#scheduleAlarmTimeout(actorId, timestamp);
	}

	/**
	 * Perform the actual write operation with atomic writes
	 */
	async #performWrite(actorId: string, state: ActorState): Promise<void> {
		const dataPath = this.getActorStatePath(actorId);
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

	/**
	 * Call this method after the actor driver has been initiated.
	 *
	 * This will trigger all initial alarms from the file system.
	 *
	 * This needs to be sync since DriverConfig.actor is sync
	 */
	onRunnerStart(
		registryConfig: RegistryConfig,
		runConfig: RunConfig,
		inlineClient: AnyClient,
		actorDriver: ActorDriver,
	) {
		if (this.#runnerParams) {
			logger().warn("already called onRunnerStart");
			return;
		}

		// Save runner params for future use
		this.#runnerParams = {
			registryConfig,
			runConfig,
			inlineClient,
			actorDriver,
		};

		// Load alarms from disk and schedule timeouts
		try {
			this.#loadAlarmsSync();
		} catch (err) {
			logger().error("failed to load alarms on startup", { error: err });
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
		return this.getActorDbPath(actorId);
	}

	/**
	 * Load all persisted alarms from disk and schedule their timers.
	 */
	#loadAlarmsSync(): void {
		try {
			const files = fsSync.existsSync(this.#alarmsDir)
				? fsSync.readdirSync(this.#alarmsDir)
				: [];
			for (const file of files) {
				// Skip temp files
				if (file.includes(".tmp.")) continue;
				const fullPath = path.join(this.#alarmsDir, file);
				try {
					const buf = fsSync.readFileSync(fullPath);
					const timestamp = cbor.decode(buf) as number;
					if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
						this.#scheduleAlarmTimeout(file, timestamp);
					} else {
						logger().debug("invalid alarm file contents", { file });
					}
				} catch (err) {
					logger().error("failed to read alarm file", {
						file,
						error: stringifyError(err),
					});
				}
			}
		} catch (err) {
			logger().error("failed to list alarms directory", { error: err });
		}
	}

	/**
	 * Schedule an alarm timer for an actor without writing to disk.
	 */
	#scheduleAlarmTimeout(actorId: string, timestamp: number) {
		const entry = this.#upsertEntry(actorId);

		// If there's already an earlier alarm scheduled, do not override it.
		if (
			entry.alarmTimestamp !== undefined &&
			timestamp >= entry.alarmTimestamp
		) {
			logger().debug("skipping alarm schedule (later than existing)", {
				actorId,
				timestamp,
				current: entry.alarmTimestamp,
			});
			return;
		}

		logger().debug("scheduling alarm", { actorId, timestamp });

		// Cancel existing timeout and update the current scheduled timestamp
		entry.alarmTimeout?.abort();
		entry.alarmTimestamp = timestamp;

		const delay = Math.max(0, timestamp - Date.now());
		entry.alarmTimeout = setLongTimeout(async () => {
			// Clear currently scheduled timestamp as this alarm is firing now
			entry.alarmTimestamp = undefined;
			// On trigger: remove persisted alarm file
			if (this.#persist) {
				try {
					await fs.unlink(this.getActorAlarmPath(actorId));
				} catch (err: any) {
					if (err?.code !== "ENOENT") {
						logger().debug("failed to remove alarm file", {
							actorId,
							error: stringifyError(err),
						});
					}
				}
			}

			try {
				logger().debug("triggering alarm", { actorId, timestamp });

				// Ensure actor state exists and start actor if needed
				const loaded = await this.loadActor(actorId);
				if (!loaded.state) throw new Error(`Actor does not exist: ${actorId}`);

				// Start actor if not already running
				const runnerParams = this.#runnerParams;
				invariant(runnerParams, "missing runner params");
				if (!loaded.actor) {
					await this.startActor(
						runnerParams.registryConfig,
						runnerParams.runConfig,
						runnerParams.inlineClient,
						runnerParams.actorDriver,
						actorId,
					);
				}

				invariant(loaded.actor, "actor should be loaded after wake");
				await loaded.actor._onAlarm();
			} catch (err) {
				logger().error("failed to handle alarm", {
					actorId,
					error: stringifyError(err),
				});
			}
		}, delay);
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
			const files = fsSync.readdirSync(this.#stateDir);
			const tempFiles = files.filter((f) => f.includes(".tmp."));

			const oneHourAgo = Date.now() - 3600000; // 1 hour in ms

			for (const tempFile of tempFiles) {
				try {
					const fullPath = path.join(this.#stateDir, tempFile);
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
