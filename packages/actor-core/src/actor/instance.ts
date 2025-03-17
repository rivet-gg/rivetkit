import type { PersistedConn } from "./connection";
import type { Logger } from "@/common//log";
import { type ActorTags, isJsonSerializable } from "@/common//utils";
import onChange from "on-change";
import type { ActorConfig } from "./config";
import { Connection, type ConnectionId } from "./connection";
import type { ActorDriver, ConnectionDrivers } from "./driver";
import type { ConnectionDriver } from "./driver";
import * as errors from "./errors";
import { processMessage } from "./protocol/message/mod";
import { instanceLogger, logger } from "./log";
import { ActionContext } from "./action";
import { Lock, deadline } from "./utils";
import { Schedule } from "./schedule";
import { KEYS } from "./keys";
import type * as wsToServer from "@/actor/protocol/message/to-server";
import { CachedSerializer } from "./protocol/serde";
import { Inspector } from "@/actor/inspect";
import { ActorContext } from "./context";

/**
 * Options for the `_saveState` method.
 */
export interface SaveStateOptions {
	/**
	 * Forces the state to be saved immediately. This function will return when the state has saved successfully.
	 */
	immediate?: boolean;
}

/** Actor type alias with all `any` types. Used for `extends` in classes referencing this actor. */
// biome-ignore lint/suspicious/noExplicitAny: Needs to be used in `extends`
export type AnyActorInstance = ActorInstance<any, any, any>;

export type ExtractActorState<A extends AnyActorInstance> =
	A extends ActorInstance<
		infer State,
		// biome-ignore lint/suspicious/noExplicitAny: Must be used for `extends`
		any,
		// biome-ignore lint/suspicious/noExplicitAny: Must be used for `extends`
		any
	>
		? State
		: never;

export type ExtractActorConnParams<A extends AnyActorInstance> =
	A extends ActorInstance<
		// biome-ignore lint/suspicious/noExplicitAny: Must be used for `extends`
		any,
		infer ConnParams,
		// biome-ignore lint/suspicious/noExplicitAny: Must be used for `extends`
		any
	>
		? ConnParams
		: never;

export type ExtractActorConnState<A extends AnyActorInstance> =
	A extends ActorInstance<
		// biome-ignore lint/suspicious/noExplicitAny: Must be used for `extends`
		any,
		// biome-ignore lint/suspicious/noExplicitAny: Must be used for `extends`
		any,
		infer ConnState
	>
		? ConnState
		: never;

/** State object that gets automatically persisted to storage. */
interface PersistedActor<S, CP, CS> {
	// State
	s: S;
	// Connections
	c: PersistedConn<CP, CS>[];
}

export class ActorInstance<S, CP, CS> {
	// Shared actor context for this instance
	actorContext: ActorContext<S, CP, CS>;
	isStopping = false;

	#persistChanged = false;

	/**
	 * The proxied state that notifies of changes automatically.
	 *
	 * Any data that should be stored indefinitely should be held within this object.
	 */
	#persist!: PersistedActor<S, CP, CS>;

	/** Raw state without the proxy wrapper */
	#persistRaw!: PersistedActor<S, CP, CS>;

	#writePersistLock = new Lock<void>(void 0);

	#lastSaveTime = 0;
	#pendingSaveTimeout?: NodeJS.Timeout;

	#backgroundPromises: Promise<void>[] = [];
	#config: ActorConfig<S, CP, CS>;
	#connectionDrivers!: ConnectionDrivers;
	#actorDriver!: ActorDriver;
	#actorId!: string;
	#name!: string;
	#tags!: ActorTags;
	#region!: string;
	#ready = false;

	#connections = new Map<ConnectionId, Connection<S, CP, CS>>();
	#subscriptionIndex = new Map<string, Set<Connection<S, CP, CS>>>();

	#schedule!: Schedule;

	/**
	 * Inspector for the actor.
	 * @internal
	 */
	inspector!: Inspector;

	get id() {
		return this.#actorId;
	}

	/**
	 * This constructor should never be used directly.
	 *
	 * Constructed in {@link ActorInstance.start}.
	 *
	 * @private
	 */
	constructor(config: ActorConfig<S, CP, CS>) {
		this.#config = config;
		this.actorContext = new ActorContext(this);
	}

	async start(
		connectionDrivers: ConnectionDrivers,
		actorDriver: ActorDriver,
		actorId: string,
		name: string,
		tags: ActorTags,
		region: string,
	) {
		this.#connectionDrivers = connectionDrivers;
		this.#actorDriver = actorDriver;
		this.#actorId = actorId;
		this.#name = name;
		this.#tags = tags;
		this.#region = region;
		this.#schedule = new Schedule(this, actorDriver);
		this.inspector = new Inspector(this);

		// Initialize server
		//
		// Store the promise so network requests can await initialization
		await this.#initialize();

		// TODO: Exit process if this errors
		logger().info("actor starting");
		if (this.#config.onStart) {
			const result = this.#config.onStart();
			if (result instanceof Promise) {
				await result;
			}
		}

		logger().info("actor ready");
		this.#ready = true;
	}

	async onAlarm() {
		await this.#schedule.__onAlarm();
	}

	get stateEnabled() {
		return "createState" in this.#config || "state" in this.#config;
	}

	#validateStateEnabled() {
		if (!this.stateEnabled) {
			throw new errors.StateNotEnabled();
		}
	}

	get #connectionStateEnabled() {
		return (
			"createConnectionState" in this.#config ||
			"connectionState" in this.#config
		);
	}

	/** Promise used to wait for a save to complete. This is required since you cannot await `#saveStateThrottled`. */
	#onPersistSavedPromise?: PromiseWithResolvers<void>;

	/** Throttled save state method. Used to write to KV at a reasonable cadence. */
	#savePersistThrottled() {
		const now = Date.now();
		const timeSinceLastSave = now - this.#lastSaveTime;
		const saveInterval = this.#config.options.state.saveInterval;

		// If we're within the throttle window and not already scheduled, schedule the next save.
		if (timeSinceLastSave < saveInterval) {
			if (this.#pendingSaveTimeout === undefined) {
				this.#pendingSaveTimeout = setTimeout(() => {
					this.#pendingSaveTimeout = undefined;
					this.#savePersistInner();
				}, saveInterval - timeSinceLastSave);
			}
		} else {
			// If we're outside the throttle window, save immediately
			this.#savePersistInner();
		}
	}

	/** Saves the state to KV. You probably want to use #saveStateThrottled instead except for a few edge cases. */
	async #savePersistInner() {
		try {
			this.#lastSaveTime = Date.now();

			if (this.#persistChanged) {
				// Use a lock in order to avoid race conditions with multiple
				// parallel promises writing to KV. This should almost never happen
				// unless there are abnormally high latency in KV writes.
				await this.#writePersistLock.lock(async () => {
					logger().debug("saving persist");

					// There might be more changes while we're writing, so we set this
					// before writing to KV in order to avoid a race condition.
					this.#persistChanged = false;

					// Write to KV
					await this.#actorDriver.kvPut(
						this.#actorId,
						KEYS.STATE.DATA,
						this.#persistRaw,
					);

					logger().debug("persist saved");
				});
			}

			this.#onPersistSavedPromise?.resolve();
		} catch (error) {
			this.#onPersistSavedPromise?.reject(error);
			throw error;
		}
	}

	/**
	 * Creates proxy for `#persist` that handles automatically flagging when state needs to be updated.
	 */
	#setPersist(target: PersistedActor<S, CP, CS>) {
		// Set raw persist object
		this.#persistRaw = target;

		// TODO: Only validate this for conn state
		// TODO: Allow disabling in production
		// If this can't be proxied, return raw value
		if (target === null || typeof target !== "object") {
			let invalidPath = "";
			if (
				!isJsonSerializable(
					target,
					(path) => {
						invalidPath = path;
					},
					"",
				)
			) {
				throw new errors.InvalidStateType({ path: invalidPath });
			}
			return target;
		}

		// Unsubscribe from old state
		if (this.#persist) {
			onChange.unsubscribe(this.#persist);
		}

		// Listen for changes to the object in order to automatically write state
		this.#persist = onChange(
			target,
			// biome-ignore lint/suspicious/noExplicitAny: Don't know types in proxy
			(path: string, value: any, _previousValue: any, _applyData: any) => {
				let invalidPath = "";
				if (
					!isJsonSerializable(
						value,
						(invalidPathPart) => {
							invalidPath = invalidPathPart;
						},
						"",
					)
				) {
					throw new errors.InvalidStateType({
						path: path + (invalidPath ? `.${invalidPath}` : ""),
					});
				}
				this.#persistChanged = true;

				// Call inspect handler
				this.inspector.onStateChange(this.#persistRaw.s);

				// Call onStateChange if it exists
				if (this.#config.onStateChange && this.#ready) {
					try {
						this.#config.onStateChange(this.#persistRaw.s);
					} catch (error) {
						logger().error("error in `_onStateChange`", {
							error: `${error}`,
						});
					}
				}

				// State will be flushed at the end of the RPC
			},
			{ ignoreDetached: true },
		);
	}

	async #initialize() {
		// Read initial state
		const [initialized, persistData] = (await this.#actorDriver.kvGetBatch(
			this.#actorId,
			[KEYS.STATE.INITIALIZED, KEYS.STATE.DATA],
		)) as [boolean, PersistedActor<S, CP, CS>];

		if (initialized) {
			logger().info("actor restoring", {
				connections: persistData.c.length,
			});

			// Set initial state
			this.#setPersist(persistData);

			// Load connections
			for (const connPersist of this.#persist.c) {
				// Create connections
				const driver = this.__getConnectionDriver(connPersist.d);
				const conn = new Connection<S, CP, CS>(
					this,
					connPersist,
					driver,
					this.#connectionStateEnabled,
				);
				this.#connections.set(conn.id, conn);

				// Register event subscriptions
				for (const sub of connPersist.su) {
					this.#addSubscription(sub.n, conn, true);
				}
			}
		} else {
			logger().info("actor creating");

			if (this.#config.onCreate) {
				await this.#config.onCreate();
			}

			// Initialize actor state
			let stateData: unknown = undefined;
			if (this.stateEnabled) {
				logger().info("actor state initializing");

				if ("createState" in this.#config) {
					this.#config.createState;
					stateData = await this.#config.createState();
				} else if ("state" in this.#config) {
					stateData = structuredClone(this.#config.state);
				} else {
					throw new Error("Both 'createState' or 'state' were not defined");
				}
			} else {
				logger().debug("state not enabled");
			}

			const persist: PersistedActor<S, CP, CS> = {
				s: stateData as S,
				c: [],
			};

			// Update state
			logger().debug("writing state");
			await this.#actorDriver.kvPutBatch(this.#actorId, [
				[KEYS.STATE.INITIALIZED, true],
				[KEYS.STATE.DATA, persist],
			]);

			this.#setPersist(persist);
		}
	}

	__getConnectionForId(id: string): Connection<S, CP, CS> | undefined {
		return this.#connections.get(id);
	}

	/**
	 * Removes a connection and cleans up its resources.
	 */
	__removeConnection(conn: Connection<S, CP, CS> | undefined) {
		if (!conn) {
			logger().warn("`conn` does not exist");
			return;
		}

		// Remove from persist & save immediately
		const connIdx = this.#persist.c.findIndex((c) => c.i === conn.id);
		if (connIdx !== -1) {
			this.#persist.c.splice(connIdx, 1);
			this.saveState({ immediate: true });
		} else {
			logger().warn("could not find persisted connection to remove", {
				connId: conn.id,
			});
		}

		// Remove from state
		this.#connections.delete(conn.id);

		// Remove subscriptions
		for (const eventName of [...conn.subscriptions.values()]) {
			this.#removeSubscription(eventName, conn, true);
		}

		this.inspector.onConnectionsChange(this.#connections);
		if (this.#config.onDisconnect) {
			try {
				const result = this.#config.onDisconnect(conn);
				if (result instanceof Promise) {
					// Handle promise but don't await it to prevent blocking
					result.catch((error) => {
						logger().error("error in `onDisconnect`", {
							error: `${error}`,
						});
					});
				}
			} catch (error) {
				logger().error("error in `onDisconnect`", {
					error: `${error}`,
				});
			}
		}
	}

	async prepareConnection(
		// biome-ignore lint/suspicious/noExplicitAny: TypeScript bug with ExtractActorConnParams<this>,
		parameters: any,
		request?: Request,
	): Promise<CS> {
		// Authenticate connection
		let connState: CS | undefined = undefined;
		const PREPARE_CONNECT_TIMEOUT = 5000; // 5 seconds

		const onBeforeConnectOpts = {
			request,
			parameters,
		};

		if (this.#config.onBeforeConnect) {
			await this.#config.onBeforeConnect(onBeforeConnectOpts);
		}

		if (this.#connectionStateEnabled) {
			if ("createConnectionState" in this.#config) {
				const dataOrPromise =
					this.#config.createConnectionState(onBeforeConnectOpts);
				if (dataOrPromise instanceof Promise) {
					connState = await deadline(dataOrPromise, PREPARE_CONNECT_TIMEOUT);
				} else {
					connState = dataOrPromise;
				}
			} else if ("connectionState" in this.#config) {
				connState = structuredClone(this.#config.connectionState);
			} else {
				throw new Error(
					"Could not create connection state from 'createConnectionState' or 'connectionState'",
				);
			}
		}

		return connState as CS;
	}

	__getConnectionDriver(driverId: string): ConnectionDriver {
		// Get driver
		const driver = this.#connectionDrivers[driverId];
		if (!driver) throw new Error(`No connection driver: ${driverId}`);
		return driver;
	}

	/**
	 * Called after establishing a connection handshake.
	 */
	async createConnection(
		connectionId: string,
		connectionToken: string,
		parameters: CP,
		state: CS,
		driverId: string,
		driverState: unknown,
	): Promise<Connection<S, CP, CS>> {
		if (this.#connections.has(connectionId)) {
			throw new Error(`Connection already exists: ${connectionId}`);
		}

		// Create connection
		const driver = this.__getConnectionDriver(driverId);
		const persist: PersistedConn<CP, CS> = {
			i: connectionId,
			t: connectionToken,
			d: driverId,
			ds: driverState,
			p: parameters,
			s: state,
			su: [],
		};
		const conn = new Connection<S, CP, CS>(
			this,
			persist,
			driver,
			this.#connectionStateEnabled,
		);
		this.#connections.set(conn.id, conn);

		// Add to persistence & save immediately
		this.#persist.c.push(persist);
		this.saveState({ immediate: true });

		this.inspector.onConnectionsChange(this.#connections);

		// Handle connection
		const CONNECT_TIMEOUT = 5000; // 5 seconds
		if (this.#config.onConnect) {
			try {
				const result = this.#config.onConnect(conn);
				if (result instanceof Promise) {
					deadline(result, CONNECT_TIMEOUT).catch((error) => {
						logger().error("error in `onConnect`, closing socket", {
							error,
						});
						conn?.disconnect("`onConnect` failed");
					});
				}
			} catch (error) {
				logger().error("error in `onConnect`", {
					error: `${error}`,
				});
				conn?.disconnect("`onConnect` failed");
			}
		}

		// Send init message
		conn._sendMessage(
			new CachedSerializer({
				b: {
					i: {
						ci: `${conn.id}`,
						ct: conn._token,
					},
				},
			}),
		);

		return conn;
	}

	// MARK: Messages
	async processMessage(
		message: wsToServer.ToServer,
		conn: Connection<S, CP, CS>,
	) {
		await processMessage(message, this, conn, {
			onExecuteRpc: async (ctx, name, args) => {
				return await this.executeRpc(ctx, name, args);
			},
			onSubscribe: async (eventName, conn) => {
				this.#addSubscription(eventName, conn, false);
			},
			onUnsubscribe: async (eventName, conn) => {
				this.#removeSubscription(eventName, conn, false);
			},
		});
	}

	// MARK: Events
	#addSubscription(
		eventName: string,
		connection: Connection<S, CP, CS>,
		fromPersist: boolean,
	) {
		if (connection.subscriptions.has(eventName)) {
			logger().info("connection already has subscription", { eventName });
			return;
		}

		// Persist subscriptions & save immediately
		//
		// Don't update persistence if already restoring from persistence
		if (!fromPersist) {
			connection.__persist.su.push({ n: eventName });
			this.saveState({ immediate: true });
		}

		// Update subscriptions
		connection.subscriptions.add(eventName);

		// Update subscription index
		let subscribers = this.#subscriptionIndex.get(eventName);
		if (!subscribers) {
			subscribers = new Set();
			this.#subscriptionIndex.set(eventName, subscribers);
		}
		subscribers.add(connection);
	}

	#removeSubscription(
		eventName: string,
		connection: Connection<S, CP, CS>,
		fromRemoveConn: boolean,
	) {
		if (!connection.subscriptions.has(eventName)) {
			logger().warn("connection does not have subscription", { eventName });
			return;
		}

		// Persist subscriptions & save immediately
		//
		// Don't update the connection itself if the connection is already being removed
		if (!fromRemoveConn) {
			connection.subscriptions.delete(eventName);

			const subIdx = connection.__persist.su.findIndex(
				(s) => s.n === eventName,
			);
			if (subIdx !== -1) {
				connection.__persist.su.splice(subIdx, 1);
			} else {
				logger().warn("subscription does not exist with name", { eventName });
			}

			this.saveState({ immediate: true });
		}

		// Update scriptions index
		const subscribers = this.#subscriptionIndex.get(eventName);
		if (subscribers) {
			subscribers.delete(connection);
			if (subscribers.size === 0) {
				this.#subscriptionIndex.delete(eventName);
			}
		}
	}

	#assertReady() {
		if (!this.#ready) throw new errors.InternalError("Actor not ready");
	}

	/**
	 * Execute an RPC call from a client.
	 *
	 * This method handles:
	 * 1. Validating the RPC name
	 * 2. Executing the RPC function
	 * 3. Processing the result through onBeforeRpcResponse (if configured)
	 * 4. Handling timeouts and errors
	 * 5. Saving state changes
	 *
	 * @param ctx The RPC context
	 * @param rpcName The name of the RPC being called
	 * @param args The arguments passed to the RPC
	 * @returns The result of the RPC call
	 * @throws {RpcNotFound} If the RPC doesn't exist
	 * @throws {RpcTimedOut} If the RPC times out
	 * @internal
	 */
	async executeRpc(
		ctx: ActionContext<S, CP, CS>,
		rpcName: string,
		args: unknown[],
	): Promise<unknown> {
		// Prevent calling private or reserved methods
		if (!(rpcName in this.#config.actions)) {
			logger().warn("rpc does not exist", { rpcName });
			throw new errors.ActionNotFound();
		}

		// Check if the method exists on this object
		// biome-ignore lint/suspicious/noExplicitAny: RPC name is dynamic from client
		const rpcFunction = this.#config.actions[rpcName];
		if (typeof rpcFunction !== "function") {
			logger().warn("action not found", { actionName: rpcName });
			throw new errors.ActionNotFound();
		}

		// TODO: pass abortable to the rpc to decide when to abort
		// TODO: Manually call abortable for better error handling
		// Call the function on this object with those arguments
		try {
			const outputOrPromise = rpcFunction.call(undefined, ctx, ...args);
			let output: unknown;
			if (outputOrPromise instanceof Promise) {
				output = await deadline(
					outputOrPromise,
					this.#config.options.action.timeout,
				);
			} else {
				output = outputOrPromise;
			}

			// Process the output through onBeforeRpcResponse if configured
			if (this.#config.onBeforeActionResponse) {
				try {
					const processedOutput = this.#config.onBeforeActionResponse(
						rpcName,
						args,
						output,
					);
					if (processedOutput instanceof Promise) {
						output = await processedOutput;
					} else {
						output = processedOutput;
					}
				} catch (error) {
					logger().error("error in `onBeforeRpcResponse`", {
						error: `${error}`,
					});
				}
			}

			return output;
		} catch (error) {
			if (error instanceof DOMException && error.name === "TimeoutError") {
				throw new errors.ActionTimedOut();
			}
			throw error;
		} finally {
			this.#savePersistThrottled();
		}
	}

	/**
	 * Returns a list of RPC methods available on this actor.
	 */
	get rpcs(): string[] {
		return Object.keys(this.#config.actions);
	}

	// MARK: Lifecycle hooks

	// MARK: Exposed methods
	/**
	 * Gets the logger instance.
	 */
	get log(): Logger {
		return instanceLogger();
	}

	/**
	 * Gets the name.
	 */
	get name(): string {
		return this.#name;
	}

	/**
	 * Gets the tags.
	 */
	get tags(): ActorTags {
		return this.#tags;
	}

	/**
	 * Gets the region.
	 */
	get region(): string {
		return this.#region;
	}

	/**
	 * Gets the scheduler.
	 */
	get schedule(): Schedule {
		return this.#schedule;
	}

	/**
	 * Gets the map of connections.
	 */
	get connections(): Map<ConnectionId, Connection<S, CP, CS>> {
		return this.#connections;
	}

	/**
	 * Gets the current state.
	 *
	 * Changing properties of this value will automatically be persisted.
	 */
	get state(): S {
		this.#validateStateEnabled();
		return this.#persist.s;
	}

	/**
	 * Sets the current state.
	 *
	 * This property will automatically be persisted.
	 */
	set state(value: S) {
		this.#validateStateEnabled();
		this.#persist.s = value;
	}

	/**
	 * Broadcasts an event to all connected clients.
	 * @param name - The name of the event.
	 * @param args - The arguments to send with the event.
	 */
	_broadcast<Args extends Array<unknown>>(name: string, ...args: Args) {
		this.#assertReady();

		// Send to all connected clients
		const subscriptions = this.#subscriptionIndex.get(name);
		if (!subscriptions) return;

		const toClientSerializer = new CachedSerializer({
			b: {
				ev: {
					n: name,
					a: args,
				},
			},
		});

		// Send message to clients
		for (const connection of subscriptions) {
			connection._sendMessage(toClientSerializer);
		}
	}

	/**
	 * Runs a promise in the background.
	 *
	 * This allows the actor runtime to ensure that a promise completes while
	 * returning from an RPC request early.
	 *
	 * @param promise - The promise to run in the background.
	 */
	_runInBackground(promise: Promise<void>) {
		this.#assertReady();

		// TODO: Should we force save the state?
		// Add logging to promise and make it non-failable
		const nonfailablePromise = promise
			.then(() => {
				logger().debug("background promise complete");
			})
			.catch((error) => {
				logger().error("background promise failed", {
					error: `${error}`,
				});
			});
		this.#backgroundPromises.push(nonfailablePromise);
	}

	/**
	 * Forces the state to get saved.
	 *
	 * This is helpful if running a long task that may fail later or when
	 * running a background job that updates the state.
	 *
	 * @param opts - Options for saving the state.
	 */
	async saveState(opts: SaveStateOptions) {
		this.#assertReady();

		if (this.#persistChanged) {
			if (opts.immediate) {
				// Save immediately
				await this.#savePersistInner();
			} else {
				// Create callback
				if (!this.#onPersistSavedPromise) {
					this.#onPersistSavedPromise = Promise.withResolvers();
				}

				// Save state throttled
				this.#savePersistThrottled();

				// Wait for save
				await this.#onPersistSavedPromise.promise;
			}
		}
	}

	async stop() {
		if (this.isStopping) {
			logger().warn("already stopping actor");
			return;
		}
		this.isStopping = true;

		// Write state
		await this.saveState({ immediate: true });

		// Disconnect existing connections
		const promises: Promise<unknown>[] = [];
		for (const connection of this.#connections.values()) {
			promises.push(connection.disconnect());

			// TODO: Figure out how to abort HTTP requests on shutdown
		}

		// Await all `close` event listeners with 1.5 second timeout
		const res = Promise.race([
			Promise.all(promises).then(() => false),
			new Promise<boolean>((res) =>
				globalThis.setTimeout(() => res(true), 1500),
			),
		]);

		if (await res) {
			logger().warn(
				"timed out waiting for connections to close, shutting down anyway",
			);
		}

		// TODO:
		//Deno.exit(0);
	}
}
