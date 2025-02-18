import * as protoHttpRpc from "@/actor/protocol/http/rpc";
import type { PersistedConn } from "./connection";
import type * as wsToClient from "@/actor/protocol/message/to_client";
import type { Logger } from "@/common//log";
import { listObjectMethods } from "@/common//reflect";
import { ActorTags, isJsonSerializable } from "@/common//utils";
import { HonoRequest, type Context as HonoContext } from "hono";
import { streamSSE } from "hono/streaming";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { WSContext, WSEvents } from "hono/ws";
import onChange from "on-change";
import { type ActorConfig, mergeActorConfig } from "./actor_config";
import { Connection, type ConnectionId } from "./connection";
import type { ActorDriver, ConnectionDrivers } from "./driver";
import type { ConnectionDriver } from "./driver";
import * as errors from "../errors";
import { parseMessage, processMessage } from "../protocol/message/mod";
import { instanceLogger, logger } from "./log";
import { Rpc } from "./rpc";
import { Lock, assertUnreachable, deadline } from "./utils";
import { Schedule } from "./schedule";
import { KEYS } from "./keys";
import * as wsToServer from "@/actor/protocol/message/to_server";
import {
	Encoding,
	EncodingSchema,
	InputData,
	CachedSerializer,
	encodeDataToString,
} from "../protocol/serde";

/**
 * Options for the `_onBeforeConnect` method.
 *
 * @see {@link https://rivet.gg/docs/connections|Connections Documentation}
 */
export interface OnBeforeConnectOptions<A extends AnyActor> {
	/**
	 * The request object associated with the connection.
	 *
	 * @experimental
	 */
	request?: Request;

	/**
	 * The parameters passed when a client connects to the actor.
	 */
	parameters: ExtractActorConnParams<A>;
}

/**
 * Options for the `_saveState` method.
 *
 * @see {@link https://rivet.gg/docs/state|State Documentation}
 */
export interface SaveStateOptions {
	/**
	 * Forces the state to be saved immediately. This function will return when the state has saved successfully.
	 */
	immediate?: boolean;
}

/** Actor type alias with all `any` types. Used for `extends` in classes referencing this actor. */
// biome-ignore lint/suspicious/noExplicitAny: Needs to be used in `extends`
export type AnyActor = Actor<any, any, any>;

export type AnyActorConstructor = new (
	// biome-ignore lint/suspicious/noExplicitAny: Needs to be used in `extends`
	...args: ConstructorParameters<typeof Actor<any, any, any>>
	// biome-ignore lint/suspicious/noExplicitAny: Needs to be used in `extends`
) => Actor<any, any, any>;

export type ExtractActorState<A extends AnyActor> = A extends Actor<
	infer State,
	// biome-ignore lint/suspicious/noExplicitAny: Must be used for `extends`
	any,
	// biome-ignore lint/suspicious/noExplicitAny: Must be used for `extends`
	any
>
	? State
	: never;

export type ExtractActorConnParams<A extends AnyActor> = A extends Actor<
	// biome-ignore lint/suspicious/noExplicitAny: Must be used for `extends`
	any,
	infer ConnParams,
	// biome-ignore lint/suspicious/noExplicitAny: Must be used for `extends`
	any
>
	? ConnParams
	: never;

export type ExtractActorConnState<A extends AnyActor> = A extends Actor<
	// biome-ignore lint/suspicious/noExplicitAny: Must be used for `extends`
	any,
	// biome-ignore lint/suspicious/noExplicitAny: Must be used for `extends`
	any,
	infer ConnState
>
	? ConnState
	: never;

/** State object that gets automatically persisted to storage. */
interface PersistedActor<A extends AnyActor> {
	// State
	s: ExtractActorState<A>;
	// Connections
	c: PersistedConn<A>[];
}

/**
 * Abstract class representing a Rivet Actor. Extend this class to implement logic for your actor.
 *
 * @template State Represents the actor's state, which is stored in-memory and persisted automatically. This allows you to work with data without added latency while still being able to survive crashes & upgrades. Must define `_onInitialize` to create the initial state. For more details, see the {@link https://rivet.gg/docs/state|State Documentation}.
 * @template ConnParams Represents the parameters passed when a client connects to the actor. These parameters can be used for authentication or other connection-specific logic. For more details, see the {@link https://rivet.gg/docs/connections|Connections Documentation}.
 * @template ConnState Represents the state of a connection, which is initialized from the data returned by `_onBeforeConnect`. This state can be accessed in any actor method using `connection.state`. For more details, see the {@link https://rivet.gg/docs/connections|Connections Documentation}.
 * @see {@link https://rivet.gg/docs|Documentation}
 * @see {@link https://rivet.gg/docs/setup|Initial Setup}
 * @see {@link https://rivet.gg/docs/manage|Create & Manage Actors}
 * @see {@link https://rivet.gg/docs/rpc|Remote Procedure Calls}
 * @see {@link https://rivet.gg/docs/state|State}
 * @see {@link https://rivet.gg/docs/events|Events}
 * @see {@link https://rivet.gg/docs/lifecycle|Lifecycle}
 * @see {@link https://rivet.gg/docs/connections|Connections}
 * @see {@link https://rivet.gg/docs/authentication|Authentication}
 * @see {@link https://rivet.gg/docs/logging|Logging}
 */
export abstract class Actor<
	State = undefined,
	ConnParams = undefined,
	ConnState = undefined,
> {
	__isStopping = false;

	#persistChanged = false;

	/**
	 * The proxied state that notifies of changes automatically.
	 *
	 * Any data that should be stored indefinitely should be held within this object.
	 */
	#persist!: PersistedActor<Actor<State, ConnParams, ConnState>>;

	/** Raw state without the proxy wrapper */
	#persistRaw!: PersistedActor<Actor<State, ConnParams, ConnState>>;

	#writePersistLock = new Lock<void>(void 0);

	#lastSaveTime = 0;
	#pendingSaveTimeout?: NodeJS.Timeout;

	#backgroundPromises: Promise<void>[] = [];
	#config: ActorConfig;
	#connectionDrivers!: ConnectionDrivers;
	#actorDriver!: ActorDriver;
	#actorId!: string;
	#tags!: ActorTags;
	#region!: string;
	#ready = false;

	#connections = new Map<
		ConnectionId,
		Connection<Actor<State, ConnParams, ConnState>>
	>();
	#subscriptionIndex = new Map<
		string,
		Set<Connection<Actor<State, ConnParams, ConnState>>>
	>();

	#schedule!: Schedule;

	get id() {
		return this.#actorId;
	}

	/**
	 * This constructor should never be used directly.
	 *
	 * Constructed in {@link Actor.start}.
	 *
	 * @private
	 */
	public constructor(config?: Partial<ActorConfig>) {
		this.#config = mergeActorConfig(config);
	}

	async __start(
		connectionDrivers: ConnectionDrivers,
		actorDriver: ActorDriver,
		actorId: string,
		tags: ActorTags,
		region: string,
	) {
		this.#connectionDrivers = connectionDrivers;
		this.#actorDriver = actorDriver;
		this.#actorId = actorId;
		this.#tags = tags;
		this.#region = region;
		this.#schedule = new Schedule(this, actorDriver);

		// Initialize server
		//
		// Store the promise so network requests can await initialization
		await this.#initialize();

		// TODO: Exit process if this errors
		logger().info("actor starting");
		await this._onStart?.();

		logger().info("actor ready");
		this.#ready = true;
	}

	async __onAlarm() {
		await this.#schedule.__onAlarm();
	}

	get #stateEnabled() {
		return typeof this._onInitialize === "function";
	}

	#validateStateEnabled() {
		if (!this.#stateEnabled) {
			throw new errors.StateNotEnabled();
		}
	}

	get #connectionStateEnabled() {
		return typeof this._onBeforeConnect === "function";
	}

	/** Promise used to wait for a save to complete. This is required since you cannot await `#saveStateThrottled`. */
	#onPersistSavedPromise?: PromiseWithResolvers<void>;

	/** Throttled save state method. Used to write to KV at a reasonable cadence. */
	#savePersistThrottled() {
		const now = Date.now();
		const timeSinceLastSave = now - this.#lastSaveTime;
		const saveInterval = this.#config.state.saveInterval;

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
	#setPersist(target: PersistedActor<Actor<State, ConnParams, ConnState>>) {
		// Set raw perist object
		this.#persistRaw = target;

		// TODO: Only validate this for conn state
		// TODO: Allow disabling in production
		// If this can't be proxied, return raw value
		if (target === null || typeof target !== "object") {
			if (!isJsonSerializable(target)) {
				console.log("invalid value", target);
				throw new errors.InvalidStateType();
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
			(path: any, value: any, _previousValue: any, _applyData: any) => {
				if (!isJsonSerializable(value)) {
					console.log("invalid value", target);
					throw new errors.InvalidStateType({ path });
				}
				this.#persistChanged = true;

				// Call onStateChange if it exists
				if (this._onStateChange && this.#ready) {
					try {
						this._onStateChange(this.#persistRaw.s);
					} catch (error) {
						logger().error("error in `_onStateChange`", {
							error: `${error}`,
						});
					}
				}

				// State will be flushed at the end of the RPC
			},
			{
				ignoreDetached: true,
			},
		);
	}

	async #initialize() {
		// Read initial state
		const [initialized, persistData] = (await this.#actorDriver.kvGetBatch(
			this.#actorId,
			[KEYS.STATE.INITIALIZED, KEYS.STATE.DATA],
		)) as [boolean, PersistedActor<Actor<State, ConnParams, ConnState>>];

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
				const conn = new Connection<Actor<State, ConnParams, ConnState>>(
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

			// Initialize actor state
			let stateData: unknown = undefined;
			if (this.#stateEnabled) {
				if (!this._onInitialize) throw new Error("missing _onInitialize");

				logger().info("actor state initializing");

				const stateOrPromise = await this._onInitialize();

				if (stateOrPromise instanceof Promise) {
					stateData = await stateOrPromise;
				} else {
					stateData = stateOrPromise;
				}
			} else {
				logger().debug("state not enabled");
			}

			const persist: PersistedActor<Actor<State, ConnParams, ConnState>> = {
				s: stateData as State,
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

	__getConnectionForId(
		id: string,
	): Connection<Actor<State, ConnParams, ConnState>> | undefined {
		return this.#connections.get(id);
	}

	/**
	 * Removes a connection and cleans up its resources.
	 */
	__removeConnection(
		conn: Connection<Actor<State, ConnParams, ConnState>> | undefined,
	) {
		if (!conn) {
			logger().warn("`conn` does not exist");
			return;
		}

		// Remove from persist & save immediately
		const connIdx = this.#persist.c.findIndex((c) => c.i === conn.id);
		if (connIdx !== -1) {
			this.#persist.c.splice(connIdx, 1);
			this._saveState({ immediate: true });
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

		this._onDisconnect?.(conn);
	}

	async __prepareConnection(
		// biome-ignore lint/suspicious/noExplicitAny: TypeScript bug with ExtractActorConnParams<this>,
		parameters: any,
		request?: Request,
	): Promise<ConnState> {
		// Authenticate connection
		let connState: ConnState | undefined = undefined;
		const PREPARE_CONNECT_TIMEOUT = 5000; // 5 seconds
		if (this._onBeforeConnect) {
			const dataOrPromise = this._onBeforeConnect({
				request,
				parameters,
			});
			if (dataOrPromise instanceof Promise) {
				connState = await deadline(dataOrPromise, PREPARE_CONNECT_TIMEOUT);
			} else {
				connState = dataOrPromise;
			}
		}

		return connState as ConnState;
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
	async __createConnection(
		connectionId: string,
		connectionToken: string,
		parameters: ConnParams,
		state: ConnState,
		driverId: string,
		driverState: unknown,
	): Promise<Connection<Actor<State, ConnParams, ConnState>>> {
		if (this.#connections.has(connectionId)) {
			throw new Error(`Connection already exists: ${connectionId}`);
		}

		// Create connection
		const driver = this.__getConnectionDriver(driverId);
		const persist: PersistedConn<Actor<State, ConnParams, ConnState>> = {
			i: connectionId,
			t: connectionToken,
			d: driverId,
			ds: driverState,
			p: parameters,
			s: state,
			su: [],
		};
		const conn = new Connection<Actor<State, ConnParams, ConnState>>(
			this,
			persist,
			driver,
			this.#connectionStateEnabled,
		);
		this.#connections.set(conn.id, conn);

		// Add to persistence & save immediately
		this.#persist.c.push(persist);
		this._saveState({ immediate: true });

		// Handle connection
		const CONNECT_TIMEOUT = 5000; // 5 seconds
		if (this._onConnect) {
			const voidOrPromise = this._onConnect(conn);
			if (voidOrPromise instanceof Promise) {
				deadline(voidOrPromise, CONNECT_TIMEOUT).catch((error) => {
					logger().error("error in `_onConnect`, closing socket", {
						error,
					});
					conn?.disconnect("`onConnect` failed");
				});
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
	async __processMessage(
		message: wsToServer.ToServer,
		conn: Connection<Actor<State, ConnParams, ConnState>>,
	) {
		await processMessage(message, conn, {
			onExecuteRpc: async (ctx, name, args) => {
				return await this.__executeRpc(ctx, name, args);
			},
			onSubscribe: async (eventName, conn) => {
				this.#addSubscription(eventName, conn, false);
			},
			onUnsubscribe: async (eventName, conn) => {
				this.#removeSubscription(eventName, conn, false);
			},
		});
	}

	// MARK: RPC
	#isValidRpc(rpcName: string): boolean {
		// Prevent calling private methods
		if (rpcName.startsWith("#")) return false;

		// Prevent accidental leaking of private methods, since this is a common
		// convention
		if (rpcName.startsWith("_")) return false;

		// Prevent calling protected methods
		// TODO: Are there other RPC functions that should be private? i.e.	internal JS runtime functions? Should we validate the fn is part of this prototype?
		const reservedMethods = ["constructor", "initialize", "run"];
		if (reservedMethods.includes(rpcName)) return false;

		return true;
	}

	// MARK: Events
	#addSubscription(
		eventName: string,
		connection: Connection<Actor<State, ConnParams, ConnState>>,
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
			this._saveState({ immediate: true });
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
		connection: Connection<Actor<State, ConnParams, ConnState>>,
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

			this._saveState({ immediate: true });
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

	async __executeRpc(
		ctx: Rpc<Actor<State, ConnParams, ConnState>>,
		rpcName: string,
		args: unknown[],
	): Promise<unknown> {
		// Prevent calling private or reserved methods
		if (!this.#isValidRpc(rpcName)) {
			logger().warn("attempted to call invalid rpc", { rpcName });
			throw new errors.RpcNotFound();
		}

		// Check if the method exists on this object
		// biome-ignore lint/suspicious/noExplicitAny: RPC name is dynamic from client
		const rpcFunction = (this as any)[rpcName];
		if (typeof rpcFunction !== "function") {
			logger().warn("rpc not found", { rpcName });
			throw new errors.RpcNotFound();
		}

		// TODO: pass abortable to the rpc to decide when to abort
		// TODO: Manually call abortable for better error handling
		// Call the function on this object with those arguments
		try {
			const outputOrPromise = rpcFunction.call(this, ctx, ...args);
			if (outputOrPromise instanceof Promise) {
				return await this._onBeforeRpcResponse(
					rpcName,
					args,
					await deadline(outputOrPromise, this.#config.rpc.timeout),
				);
			}
			return await this._onBeforeRpcResponse(rpcName, args, outputOrPromise);
		} catch (error) {
			if (error instanceof DOMException && error.name === "TimeoutError") {
				throw new errors.RpcTimedOut();
			}
			throw error;
		} finally {
			this.#savePersistThrottled();
		}
	}

	//get #rpcNames(): string[] {
	//	return listObjectMethods(this).filter(
	//		(name): name is string =>
	//			typeof name === "string" && this.#isValidRpc(name),
	//	);
	//}

	// MARK: Lifecycle hooks
	/**
	 * Hook called when the actor is first created. This method should return the initial state of the actor. The state can be access with `this._state`.
	 *
	 * @see _state
	 * @see {@link https://rivet.gg/docs/lifecycle|Lifecycle Documentation}
	 */
	protected _onInitialize?(): State | Promise<State>;

	/**
	 * Hook called after the actor has been initialized but before any connections are accepted. If the actor crashes or is upgraded, this method will be called before startup. If you need to upgrade your state, use this method.
	 *
	 * Use this to set up any resources or start any background tasks.
	 *
	 * @see {@link https://rivet.gg/docs/lifecycle|Lifecycle Documentation}
	 */
	protected _onStart?(): void | Promise<void>;

	/**
	 * Hook called whenever the actor's state changes. This is often used to broadcast state updates.
	 *
	 * @param newState - The new state.
	 * @see {@link https://rivet.gg/docs/lifecycle|Lifecycle Documentation}
	 */
	protected _onStateChange?(newState: State): void | Promise<void>;

	/**
	 * Hook called after the RPC method is executed, but before the response is sent.
	 *
	 * This is useful for logging or auditing RPC calls.
	 *
	 * @internal
	 * @private
	 * @param _name - The name of the called RPC method.
	 * @param _args - The arguments passed to the RPC method.
	 * @param output - The output of the RPC method.
	 *
	 * @returns The output of the RPC method.
	 */
	protected _onBeforeRpcResponse<Out>(
		_name: string,
		_args: unknown[],
		output: Out,
	): Out {
		return output;
	}

	/**
	 * Called whenever a new client connects to the actor. Clients can pass parameters when connecting, accessible via `opts.parameters`.
	 *
	 * The returned value becomes the connection's initial state and can be accessed later via `connection.state`.
	 *
	 * Connections cannot interact with the actor until this method completes successfully. Throwing an error will abort the connection.
	 *
	 * @param opts - Options for the connection.
	 * @see {@link https://rivet.gg/docs/lifecycle|Lifecycle Documentation}
	 * @see {@link https://rivet.gg/docs/authentication|Authentication Documentation}
	 */
	protected _onBeforeConnect?(
		opts: OnBeforeConnectOptions<this>,
	): ConnState | Promise<ConnState>;

	/**
	 * Executed after the client has successfully connected.
	 *
	 * Messages will not be processed for this actor until this method succeeds.
	 *
	 * Errors thrown from this method will cause the client to disconnect.
	 *
	 * @param connection - The connection object.
	 * @see {@link https://rivet.gg/docs/lifecycle|Lifecycle Documentation}
	 */
	protected _onConnect?(
		connection: Connection<Actor<State, ConnParams, ConnState>>,
	): void | Promise<void> {}

	/**
	 * Called when a client disconnects from the actor. Use this to clean up any connection-specific resources.
	 *
	 * @param connection - The connection object.
	 * @see {@link https://rivet.gg/docs/lifecycle|Lifecycle Documentation}
	 */
	protected _onDisconnect?(
		connection: Connection<Actor<State, ConnParams, ConnState>>,
	): void | Promise<void> {}

	// MARK: Exposed methods
	/**
	 * Gets the logger instance.
	 *
	 * @see {@link https://rivet.gg/docs/logging|Logging Documentation}
	 */
	protected get _log(): Logger {
		return instanceLogger();
	}

	/**
	 * Gets the tags.
	 */
	protected get _tags(): ActorTags {
		return this.#tags;
	}

	/**
	 * Gets the region.
	 */
	protected get _region(): string {
		return this.#region;
	}

	/**
	 * Gets the scheduler.
	 */
	protected get _schedule(): Schedule {
		return this.#schedule;
	}

	/**
	 * Gets the map of connections.
	 *
	 * @see {@link https://rivet.gg/docs/connections|Connections Documentation}
	 */
	get _connections(): Map<
		ConnectionId,
		Connection<Actor<State, ConnParams, ConnState>>
	> {
		return this.#connections;
	}

	/**
	 * Gets the current state.
	 *
	 * Changing properties of this value will automatically be persisted.
	 *
	 * @see _onInitialize
	 * @see {@link https://rivet.gg/docs/state|State Documentation}
	 */
	protected get _state(): State {
		this.#validateStateEnabled();
		return this.#persist.s;
	}

	/**
	 * Sets the current state.
	 *
	 * This property will automatically be persisted.
	 *
	 * @see {@link https://rivet.gg/docs/state|State Documentation}
	 */
	protected set _state(value: State) {
		this.#validateStateEnabled();
		this.#persist.s = value;
	}

	/**
	 * Broadcasts an event to all connected clients.
	 * @param name - The name of the event.
	 * @param args - The arguments to send with the event.
	 * @see {@link https://rivet.gg/docs/events|Events}
	 */
	protected _broadcast<Args extends Array<unknown>>(
		name: string,
		...args: Args
	) {
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
	protected _runInBackground(promise: Promise<void>) {
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
	 * @see {@link https://rivet.gg/docs/state|State Documentation}
	 */
	protected async _saveState(opts: SaveStateOptions) {
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

	async __stop() {
		if (this.__isStopping) {
			logger().warn("already stopping actor");
			return;
		}
		this.__isStopping = true;

		// Write state
		await this._saveState({ immediate: true });

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

	// MARK: Router handlers

	//async __routeRpc(c: HonoContext): Promise<Response> {
	//}

	/** Handles a message sent to a connection over HTTP. */
	//async __routeConnectionsMessage(c: HonoContext) {
	//}
}
