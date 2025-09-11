import * as cbor from "cbor-x";
import invariant from "invariant";
import onChange from "on-change";
import type { ActorKey } from "@/actor/mod";
import type { Client } from "@/client/client";
import type { Logger } from "@/common/log";
import { isCborSerializable, stringifyError } from "@/common/utils";
import type { UniversalWebSocket } from "@/common/websocket-interface";
import { ActorInspector } from "@/inspector/actor";
import type { Registry } from "@/mod";
import type * as bareSchema from "@/schemas/actor-persist/mod";
import { PERSISTED_ACTOR_VERSIONED } from "@/schemas/actor-persist/versioned";
import type * as protocol from "@/schemas/client-protocol/mod";
import { TO_CLIENT_VERSIONED } from "@/schemas/client-protocol/versioned";
import { bufferToArrayBuffer, SinglePromiseQueue } from "@/utils";
import type { ActionContext } from "./action";
import type { ActorConfig, OnConnectOptions } from "./config";
import {
	CONNECTION_CHECK_LIVENESS_SYMBOL,
	Conn,
	type ConnectionDriver,
	type ConnId,
} from "./connection";
import { ActorContext } from "./context";
import type { AnyDatabaseProvider, InferDatabaseClient } from "./database";
import type { ActorDriver, ConnDriver, ConnectionDriversMap } from "./driver";
import * as errors from "./errors";
import { instanceLogger, logger } from "./log";
import type {
	PersistedActor,
	PersistedConn,
	PersistedScheduleEvent,
} from "./persisted";
import { processMessage } from "./protocol/old";
import { CachedSerializer } from "./protocol/serde";
import { Schedule } from "./schedule";
import { DeadlineError, deadline } from "./utils";

/**
 * Options for the `_saveState` method.
 */
export interface SaveStateOptions {
	/**
	 * Forces the state to be saved immediately. This function will return when the state has saved successfully.
	 */
	immediate?: boolean;
	/** Bypass ready check for stopping. */
	allowStoppingState?: boolean;
}

/** Actor type alias with all `any` types. Used for `extends` in classes referencing this actor. */
export type AnyActorInstance = ActorInstance<
	// biome-ignore lint/suspicious/noExplicitAny: Needs to be used in `extends`
	any,
	// biome-ignore lint/suspicious/noExplicitAny: Needs to be used in `extends`
	any,
	// biome-ignore lint/suspicious/noExplicitAny: Needs to be used in `extends`
	any,
	// biome-ignore lint/suspicious/noExplicitAny: Needs to be used in `extends`
	any,
	// biome-ignore lint/suspicious/noExplicitAny: Needs to be used in `extends`
	any,
	// biome-ignore lint/suspicious/noExplicitAny: Needs to be used in `extends`
	any,
	// biome-ignore lint/suspicious/noExplicitAny: Needs to be used in `extends`
	any
>;

export type ExtractActorState<A extends AnyActorInstance> =
	A extends ActorInstance<
		infer State,
		// biome-ignore lint/suspicious/noExplicitAny: Must be used for `extends`
		any,
		// biome-ignore lint/suspicious/noExplicitAny: Must be used for `extends`
		any,
		// biome-ignore lint/suspicious/noExplicitAny: Must be used for `extends`
		any,
		// biome-ignore lint/suspicious/noExplicitAny: Must be used for `extends`
		any,
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
		any,
		// biome-ignore lint/suspicious/noExplicitAny: Must be used for `extends`
		any,
		// biome-ignore lint/suspicious/noExplicitAny: Must be used for `extends`
		any,
		// biome-ignore lint/suspicious/noExplicitAny: Must be used for `extends`
		any,
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
		infer ConnState,
		// biome-ignore lint/suspicious/noExplicitAny: Must be used for `extends`
		any,
		// biome-ignore lint/suspicious/noExplicitAny: Must be used for `extends`
		any,
		// biome-ignore lint/suspicious/noExplicitAny: Must be used for `extends`
		any,
		// biome-ignore lint/suspicious/noExplicitAny: Must be used for `extends`
		any
	>
		? ConnState
		: never;

export class ActorInstance<
	S,
	CP,
	CS,
	V,
	I,
	AD,
	DB extends AnyDatabaseProvider,
> {
	// Shared actor context for this instance
	actorContext: ActorContext<S, CP, CS, V, I, AD, DB>;
	#sleepCalled = false;
	#stopCalled = false;

	get isStopping() {
		return this.#stopCalled || this.#sleepCalled;
	}

	#persistChanged = false;

	/**
	 * The proxied state that notifies of changes automatically.
	 *
	 * Any data that should be stored indefinitely should be held within this object.
	 */
	#persist!: PersistedActor<S, CP, CS, I>;

	/** Raw state without the proxy wrapper */
	#persistRaw!: PersistedActor<S, CP, CS, I>;

	#persistWriteQueue = new SinglePromiseQueue();
	#alarmWriteQueue = new SinglePromiseQueue();

	#lastSaveTime = 0;
	#pendingSaveTimeout?: NodeJS.Timeout;

	#vars?: V;

	#backgroundPromises: Promise<void>[] = [];
	#abortController = new AbortController();
	#config: ActorConfig<S, CP, CS, V, I, AD, DB>;
	#connectionDrivers!: ConnectionDriversMap;
	#actorDriver!: ActorDriver;
	#inlineClient!: Client<Registry<any>>;
	#actorId!: string;
	#name!: string;
	#key!: ActorKey;
	#region!: string;
	#ready = false;

	#connections = new Map<ConnId, Conn<S, CP, CS, V, I, AD, DB>>();
	#subscriptionIndex = new Map<string, Set<Conn<S, CP, CS, V, I, AD, DB>>>();
	#checkConnLivenessInterval?: NodeJS.Timeout;

	#sleepTimeout?: NodeJS.Timeout;

	// Track active raw requests so sleep logic can account for them
	#activeRawFetchCount = 0;
	#activeRawWebSockets = new Set<UniversalWebSocket>();

	#schedule!: Schedule;
	#db!: InferDatabaseClient<DB>;

	#inspector = new ActorInspector(() => {
		return {
			isDbEnabled: async () => {
				return this.#db !== undefined;
			},
			getDb: async () => {
				return this.db;
			},
			isStateEnabled: async () => {
				return this.stateEnabled;
			},
			getState: async () => {
				this.#validateStateEnabled();

				// Must return from `#persistRaw` in order to not return the `onchange` proxy
				return this.#persistRaw.state as Record<string, any> as unknown;
			},
			getRpcs: async () => {
				return Object.keys(this.#config.actions);
			},
			getConnections: async () => {
				return Array.from(this.#connections.entries()).map(([id, conn]) => ({
					id,
					stateEnabled: conn._stateEnabled,
					params: conn.params as {},
					state: conn._stateEnabled ? conn.state : undefined,
					auth: conn.auth as {},
				}));
			},
			setState: async (state: unknown) => {
				this.#validateStateEnabled();

				// Must set on `#persist` instead of `#persistRaw` in order to ensure that the `Proxy` is correctly configured
				//
				// We have to use `...` so `on-change` recognizes the changes to `state` (i.e. set #persistChanged` to true). This is because:
				// 1. In `getState`, we returned the value from `persistRaw`, which does not have the Proxy to monitor state changes
				// 2. If we were to assign `state` to `#persist.s`, `on-change` would assume nothing changed since `state` is still === `#persist.s` since we returned a reference in `getState`
				this.#persist.state = { ...(state as S) };
				await this.saveState({ immediate: true });
			},
		};
	});

	get id() {
		return this.#actorId;
	}

	get inlineClient(): Client<Registry<any>> {
		return this.#inlineClient;
	}

	get inspector() {
		return this.#inspector;
	}

	get #sleepingSupported(): boolean {
		return this.#actorDriver.sleep !== undefined;
	}

	/**
	 * This constructor should never be used directly.
	 *
	 * Constructed in {@link ActorInstance.start}.
	 *
	 * @private
	 */
	constructor(config: ActorConfig<S, CP, CS, V, I, AD, DB>) {
		this.#config = config;
		this.actorContext = new ActorContext(this);
	}

	async start(
		connectionDrivers: ConnectionDriversMap,
		actorDriver: ActorDriver,
		inlineClient: Client<Registry<any>>,
		actorId: string,
		name: string,
		key: ActorKey,
		region: string,
	) {
		this.#connectionDrivers = connectionDrivers;
		this.#actorDriver = actorDriver;
		this.#inlineClient = inlineClient;
		this.#actorId = actorId;
		this.#name = name;
		this.#key = key;
		this.#region = region;
		this.#schedule = new Schedule(this);

		// Initialize server
		//
		// Store the promise so network requests can await initialization
		await this.#initialize();

		// TODO: Exit process if this errors
		if (this.#varsEnabled) {
			let vars: V | undefined;
			if ("createVars" in this.#config) {
				const dataOrPromise = this.#config.createVars(
					this.actorContext as unknown as ActorContext<
						undefined,
						undefined,
						undefined,
						undefined,
						undefined,
						undefined,
						any
					>,
					this.#actorDriver.getContext(this.#actorId),
				);
				if (dataOrPromise instanceof Promise) {
					vars = await deadline(
						dataOrPromise,
						this.#config.options.createVarsTimeout,
					);
				} else {
					vars = dataOrPromise;
				}
			} else if ("vars" in this.#config) {
				vars = structuredClone(this.#config.vars);
			} else {
				throw new Error("Could not variables from 'createVars' or 'vars'");
			}
			this.#vars = vars;
		}

		// TODO: Exit process if this errors
		logger().info("actor starting");
		if (this.#config.onStart) {
			const result = this.#config.onStart(this.actorContext);
			if (result instanceof Promise) {
				await result;
			}
		}

		// Setup Database
		if ("db" in this.#config && this.#config.db) {
			const client = await this.#config.db.createClient({
				getDatabase: () => actorDriver.getDatabase(this.#actorId),
			});
			logger().info("database migration starting");
			await this.#config.db.onMigrate?.(client);
			logger().info("database migration complete");
			this.#db = client;
		}

		// Set alarm for next scheduled event if any exist after finishing initiation sequence
		if (this.#persist.scheduledEvents.length > 0) {
			await this.#queueSetAlarm(this.#persist.scheduledEvents[0].timestamp);
		}

		logger().info("actor ready");
		this.#ready = true;

		// Must be called after setting `#ready` or else it will not schedule sleep
		this.#resetSleepTimer();

		// Start conn liveness interval
		//
		// Check for liveness immediately since we may have connections that
		// were in `reconnecting` state when the actor went to sleep that we
		// need to purge.
		//
		// We don't use alarms for connection liveness since alarms require
		// durability & are expensive. Connection liveness is safe to assume
		// it only needs to be ran while the actor is awake and does not need
		// to manually wake the actor. The only case this is not true is if the
		// connection liveness timeout is greater than the actor sleep timeout
		// OR if the actor is manually put to sleep. In this case, the connections
		// will be stuck in a `reconnecting` state until the actor is awaken again.
		this.#checkConnLivenessInterval = setInterval(
			this.#checkConnectionsLiveness.bind(this),
			this.#config.options.connectionLivenessInterval,
		);
		this.#checkConnectionsLiveness();
	}

	async #scheduleEventInner(newEvent: PersistedScheduleEvent) {
		this.actorContext.log.info("scheduling event", newEvent);

		// Insert event in to index
		const insertIndex = this.#persist.scheduledEvents.findIndex(
			(x) => x.timestamp > newEvent.timestamp,
		);
		if (insertIndex === -1) {
			this.#persist.scheduledEvents.push(newEvent);
		} else {
			this.#persist.scheduledEvents.splice(insertIndex, 0, newEvent);
		}

		// Update alarm if:
		// - this is the newest event (i.e. at beginning of array) or
		// - this is the only event (i.e. the only event in the array)
		if (insertIndex === 0 || this.#persist.scheduledEvents.length === 1) {
			this.actorContext.log.info("setting alarm", {
				timestamp: newEvent.timestamp,
				eventCount: this.#persist.scheduledEvents.length,
			});
			await this.#queueSetAlarm(newEvent.timestamp);
		}
	}

	async _onAlarm() {
		const now = Date.now();
		this.actorContext.log.debug("alarm triggered", {
			now,
			events: this.#persist.scheduledEvents.length,
		});

		// Update sleep
		//
		// Do this before any async logic
		this.#resetSleepTimer();

		// Remove events from schedule that we're about to run
		const runIndex = this.#persist.scheduledEvents.findIndex(
			(x) => x.timestamp <= now,
		);
		if (runIndex === -1) {
			// No events are due yet. This will happen if timers fire slightly early.
			// Ensure we reschedule the alarm for the next upcoming event to avoid losing it.
			logger().warn("no events are due yet, time may have broken");
			if (this.#persist.scheduledEvents.length > 0) {
				const nextTs = this.#persist.scheduledEvents[0].timestamp;
				this.actorContext.log.warn(
					"alarm fired early, rescheduling for next event",
					{
						now,
						nextTs,
						delta: nextTs - now,
					},
				);
				await this.#queueSetAlarm(nextTs);
			}
			this.actorContext.log.debug("no events to run", { now });
			return;
		}
		const scheduleEvents = this.#persist.scheduledEvents.splice(
			0,
			runIndex + 1,
		);
		this.actorContext.log.debug("running events", {
			count: scheduleEvents.length,
		});

		// Set alarm for next event
		if (this.#persist.scheduledEvents.length > 0) {
			const nextTs = this.#persist.scheduledEvents[0].timestamp;
			this.actorContext.log.info("setting next alarm", {
				nextTs,
				remainingEvents: this.#persist.scheduledEvents.length,
			});
			await this.#queueSetAlarm(nextTs);
		}

		// Iterate by event key in order to ensure we call the events in order
		for (const event of scheduleEvents) {
			try {
				this.actorContext.log.info("running action for event", {
					event: event.eventId,
					timestamp: event.timestamp,
					action: event.kind.generic.actionName,
				});

				// Look up function
				const fn: unknown = this.#config.actions[event.kind.generic.actionName];

				if (!fn)
					throw new Error(
						`Missing action for alarm ${event.kind.generic.actionName}`,
					);
				if (typeof fn !== "function")
					throw new Error(
						`Alarm function lookup for ${event.kind.generic.actionName} returned ${typeof fn}`,
					);

				// Call function
				try {
					const args = event.kind.generic.args
						? cbor.decode(new Uint8Array(event.kind.generic.args))
						: [];
					await fn.call(undefined, this.actorContext, ...args);
				} catch (error) {
					this.actorContext.log.error("error while running event", {
						error: stringifyError(error),
						event: event.eventId,
						timestamp: event.timestamp,
						action: event.kind.generic.actionName,
					});
				}
			} catch (error) {
				this.actorContext.log.error("internal error while running event", {
					error: stringifyError(error),
					...event,
				});
			}
		}
	}

	async scheduleEvent(
		timestamp: number,
		action: string,
		args: unknown[],
	): Promise<void> {
		return this.#scheduleEventInner({
			eventId: crypto.randomUUID(),
			timestamp,
			kind: {
				generic: {
					actionName: action,
					args: bufferToArrayBuffer(cbor.encode(args)),
				},
			},
		});
	}

	get stateEnabled() {
		return "createState" in this.#config || "state" in this.#config;
	}

	#validateStateEnabled() {
		if (!this.stateEnabled) {
			throw new errors.StateNotEnabled();
		}
	}

	get #connStateEnabled() {
		return "createConnState" in this.#config || "connState" in this.#config;
	}

	get #varsEnabled() {
		return "createVars" in this.#config || "vars" in this.#config;
	}

	#validateVarsEnabled() {
		if (!this.#varsEnabled) {
			throw new errors.VarsNotEnabled();
		}
	}

	/** Promise used to wait for a save to complete. This is required since you cannot await `#saveStateThrottled`. */
	#onPersistSavedPromise?: PromiseWithResolvers<void>;

	/** Throttled save state method. Used to write to KV at a reasonable cadence. */
	#savePersistThrottled() {
		const now = Date.now();
		const timeSinceLastSave = now - this.#lastSaveTime;
		const saveInterval = this.#config.options.stateSaveInterval;

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
				const finished = this.#persistWriteQueue.enqueue(async () => {
					logger().debug("saving persist");

					// There might be more changes while we're writing, so we set this
					// before writing to KV in order to avoid a race condition.
					this.#persistChanged = false;

					// Convert to BARE types and write to KV
					const bareData = this.#convertToBarePersisted(this.#persistRaw);
					await this.#actorDriver.writePersistedData(
						this.#actorId,
						PERSISTED_ACTOR_VERSIONED.serializeWithEmbeddedVersion(bareData),
					);

					logger().debug("persist saved");
				});

				await finished;
			}

			this.#onPersistSavedPromise?.resolve();
		} catch (error) {
			this.#onPersistSavedPromise?.reject(error);
			throw error;
		}
	}

	async #queueSetAlarm(timestamp: number): Promise<void> {
		await this.#alarmWriteQueue.enqueue(async () => {
			await this.#actorDriver.setAlarm(this, timestamp);
		});
	}

	/**
	 * Creates proxy for `#persist` that handles automatically flagging when state needs to be updated.
	 */
	#setPersist(target: PersistedActor<S, CP, CS, I>) {
		// Set raw persist object
		this.#persistRaw = target;

		// TODO: Only validate this for conn state
		// TODO: Allow disabling in production
		// If this can't be proxied, return raw value
		if (target === null || typeof target !== "object") {
			let invalidPath = "";
			if (
				!isCborSerializable(
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
					!isCborSerializable(
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

				// Inform the inspector about state changes
				this.inspector.emitter.emit("stateUpdated", this.#persist.state);

				// Call onStateChange if it exists
				if (this.#config.onStateChange && this.#ready) {
					try {
						this.#config.onStateChange(
							this.actorContext,
							this.#persistRaw.state,
						);
					} catch (error) {
						logger().error("error in `_onStateChange`", {
							error: stringifyError(error),
						});
					}
				}

				// State will be flushed at the end of the action
			},
			{ ignoreDetached: true },
		);
	}

	async #initialize() {
		// Read initial state
		const persistDataBuffer = await this.#actorDriver.readPersistedData(
			this.#actorId,
		);
		invariant(
			persistDataBuffer !== undefined,
			"persist data has not been set, it should be set when initialized",
		);
		const bareData =
			PERSISTED_ACTOR_VERSIONED.deserializeWithEmbeddedVersion(
				persistDataBuffer,
			);
		const persistData = this.#convertFromBarePersisted(bareData);

		if (persistData.hasInitiated) {
			logger().info("actor restoring", {
				connections: persistData.connections.length,
			});

			// Set initial state
			this.#setPersist(persistData);

			// Load connections
			for (const connPersist of this.#persist.connections) {
				// Create connections
				const driver = this.__getConnDriver(connPersist.connDriver);
				const conn = new Conn<S, CP, CS, V, I, AD, DB>(
					this,
					connPersist,
					driver,
					this.#connStateEnabled,
				);
				this.#connections.set(conn.id, conn);

				// Register event subscriptions
				for (const sub of connPersist.subscriptions) {
					this.#addSubscription(sub.eventName, conn, true);
				}
			}
		} else {
			logger().info("actor creating");

			// Initialize actor state
			let stateData: unknown;
			if (this.stateEnabled) {
				logger().info("actor state initializing");

				if ("createState" in this.#config) {
					this.#config.createState;

					// Convert state to undefined since state is not defined yet here
					stateData = await this.#config.createState(
						this.actorContext as unknown as ActorContext<
							undefined,
							undefined,
							undefined,
							undefined,
							undefined,
							undefined,
							undefined
						>,
						persistData.input!,
					);
				} else if ("state" in this.#config) {
					stateData = structuredClone(this.#config.state);
				} else {
					throw new Error("Both 'createState' or 'state' were not defined");
				}
			} else {
				logger().debug("state not enabled");
			}

			// Save state and mark as initialized
			persistData.state = stateData as S;
			persistData.hasInitiated = true;

			// Update state
			logger().debug("writing state");
			const bareData = this.#convertToBarePersisted(persistData);
			await this.#actorDriver.writePersistedData(
				this.#actorId,
				PERSISTED_ACTOR_VERSIONED.serializeWithEmbeddedVersion(bareData),
			);

			this.#setPersist(persistData);

			// Notify creation
			if (this.#config.onCreate) {
				await this.#config.onCreate(this.actorContext, persistData.input!);
			}
		}
	}

	__getConnForId(id: string): Conn<S, CP, CS, V, I, AD, DB> | undefined {
		return this.#connections.get(id);
	}

	/**
	 * Removes a connection and cleans up its resources.
	 */
	__removeConn(conn: Conn<S, CP, CS, V, I, AD, DB> | undefined) {
		if (!conn) {
			logger().warn("`conn` does not exist");
			return;
		}

		// Remove from persist & save immediately
		const connIdx = this.#persist.connections.findIndex(
			(c) => c.connId === conn.id,
		);
		if (connIdx !== -1) {
			this.#persist.connections.splice(connIdx, 1);
			this.saveState({ immediate: true, allowStoppingState: true });
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

		this.inspector.emitter.emit("connectionUpdated");
		if (this.#config.onDisconnect) {
			try {
				const result = this.#config.onDisconnect(this.actorContext, conn);
				if (result instanceof Promise) {
					// Handle promise but don't await it to prevent blocking
					result.catch((error) => {
						logger().error("error in `onDisconnect`", {
							error: stringifyError(error),
						});
					});
				}
			} catch (error) {
				logger().error("error in `onDisconnect`", {
					error: stringifyError(error),
				});
			}
		}

		// Update sleep
		this.#resetSleepTimer();
	}

	async prepareConn(
		// biome-ignore lint/suspicious/noExplicitAny: TypeScript bug with ExtractActorConnParams<this>,
		params: any,
		request?: Request,
	): Promise<CS> {
		// Authenticate connection
		let connState: CS | undefined;

		const onBeforeConnectOpts = {
			request,
		} satisfies OnConnectOptions;

		if (this.#config.onBeforeConnect) {
			await this.#config.onBeforeConnect(
				this.actorContext,
				onBeforeConnectOpts,
				params,
			);
		}

		if (this.#connStateEnabled) {
			if ("createConnState" in this.#config) {
				const dataOrPromise = this.#config.createConnState(
					this.actorContext as unknown as ActorContext<
						undefined,
						undefined,
						undefined,
						undefined,
						undefined,
						undefined,
						undefined
					>,
					onBeforeConnectOpts,
					params,
				);
				if (dataOrPromise instanceof Promise) {
					connState = await deadline(
						dataOrPromise,
						this.#config.options.createConnStateTimeout,
					);
				} else {
					connState = dataOrPromise;
				}
			} else if ("connState" in this.#config) {
				connState = structuredClone(this.#config.connState);
			} else {
				throw new Error(
					"Could not create connection state from 'createConnState' or 'connState'",
				);
			}
		}

		return connState as CS;
	}

	__getConnDriver(driverId: ConnectionDriver): ConnDriver {
		// Get driver
		const driver = this.#connectionDrivers[driverId];
		if (!driver) throw new Error(`No connection driver: ${driverId}`);
		return driver;
	}

	/**
	 * Called after establishing a connection handshake.
	 */
	async createConn(
		connectionId: string,
		connectionToken: string,
		params: CP,
		state: CS,
		driverId: ConnectionDriver,
		driverState: unknown,
		authData: unknown,
	): Promise<Conn<S, CP, CS, V, I, AD, DB>> {
		this.#assertReady();

		if (this.#connections.has(connectionId)) {
			throw new Error(`Connection already exists: ${connectionId}`);
		}

		// Create connection
		const driver = this.__getConnDriver(driverId);
		const persist: PersistedConn<CP, CS> = {
			connId: connectionId,
			token: connectionToken,
			connDriver: driverId,
			connDriverState: driverState,
			params: params,
			state: state,
			authData: authData,
			lastSeen: Date.now(),
			subscriptions: [],
		};
		const conn = new Conn<S, CP, CS, V, I, AD, DB>(
			this,
			persist,
			driver,
			this.#connStateEnabled,
		);
		this.#connections.set(conn.id, conn);

		// Update sleep
		//
		// Do this immediately after adding connection & before any async logic in order to avoid race conditions with sleep timeouts
		this.#resetSleepTimer();

		// Add to persistence & save immediately
		this.#persist.connections.push(persist);
		this.saveState({ immediate: true });

		// Handle connection
		if (this.#config.onConnect) {
			try {
				const result = this.#config.onConnect(this.actorContext, conn);
				if (result instanceof Promise) {
					deadline(result, this.#config.options.onConnectTimeout).catch(
						(error) => {
							logger().error("error in `onConnect`, closing socket", {
								error,
							});
							conn?.disconnect("`onConnect` failed");
						},
					);
				}
			} catch (error) {
				logger().error("error in `onConnect`", {
					error: stringifyError(error),
				});
				conn?.disconnect("`onConnect` failed");
			}
		}

		this.inspector.emitter.emit("connectionUpdated");

		// Send init message
		conn._sendMessage(
			new CachedSerializer<protocol.ToClient>(
				{
					body: {
						tag: "Init",
						val: {
							actorId: this.id,
							connectionId: conn.id,
							connectionToken: conn._token,
						},
					},
				},
				TO_CLIENT_VERSIONED,
			),
		);

		return conn;
	}

	// MARK: Messages
	async processMessage(
		message: protocol.ToServer,
		conn: Conn<S, CP, CS, V, I, AD, DB>,
	) {
		await processMessage(message, this, conn, {
			onExecuteAction: async (ctx, name, args) => {
				this.inspector.emitter.emit("eventFired", {
					type: "action",
					name,
					args,
					connId: conn.id,
				});
				return await this.executeAction(ctx, name, args);
			},
			onSubscribe: async (eventName, conn) => {
				this.inspector.emitter.emit("eventFired", {
					type: "subscribe",
					eventName,
					connId: conn.id,
				});
				this.#addSubscription(eventName, conn, false);
			},
			onUnsubscribe: async (eventName, conn) => {
				this.inspector.emitter.emit("eventFired", {
					type: "unsubscribe",
					eventName,
					connId: conn.id,
				});
				this.#removeSubscription(eventName, conn, false);
			},
		});
	}

	// MARK: Events
	#addSubscription(
		eventName: string,
		connection: Conn<S, CP, CS, V, I, AD, DB>,
		fromPersist: boolean,
	) {
		if (connection.subscriptions.has(eventName)) {
			logger().debug("connection already has subscription", { eventName });
			return;
		}

		// Persist subscriptions & save immediately
		//
		// Don't update persistence if already restoring from persistence
		if (!fromPersist) {
			connection.__persist.subscriptions.push({ eventName: eventName });
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
		connection: Conn<S, CP, CS, V, I, AD, DB>,
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

			const subIdx = connection.__persist.subscriptions.findIndex(
				(s) => s.eventName === eventName,
			);
			if (subIdx !== -1) {
				connection.__persist.subscriptions.splice(subIdx, 1);
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

	#assertReady(allowStoppingState: boolean = false) {
		if (!this.#ready) throw new errors.InternalError("Actor not ready");
		if (!allowStoppingState && this.#sleepCalled)
			throw new errors.InternalError("Actor is going to sleep");
		if (!allowStoppingState && this.#stopCalled)
			throw new errors.InternalError("Actor is stopping");
	}

	/**
	 * Check the liveness of all connections.
	 * Sets up a recurring check based on the configured interval.
	 */
	#checkConnectionsLiveness() {
		logger().debug("checking connections liveness");

		for (const conn of this.#connections.values()) {
			const liveness = conn[CONNECTION_CHECK_LIVENESS_SYMBOL]();
			if (liveness.status === "connected") {
				logger().debug("connection is alive", { connId: conn.id });
			} else {
				const lastSeen = liveness.lastSeen;
				const sinceLastSeen = Date.now() - lastSeen;
				if (sinceLastSeen < this.#config.options.connectionLivenessTimeout) {
					logger().debug("connection might be alive, will check later", {
						connId: conn.id,
						lastSeen,
						sinceLastSeen,
					});
					continue;
				}

				// Connection is dead, remove it
				logger().warn("connection is dead, removing", {
					connId: conn.id,
					lastSeen,
				});

				// TODO: Do we need to force disconnect the connection here?

				this.__removeConn(conn);
			}
		}
	}

	/**
	 * Check if the actor is ready to handle requests.
	 */
	isReady(): boolean {
		return this.#ready;
	}

	/**
	 * Execute an action call from a client.
	 *
	 * This method handles:
	 * 1. Validating the action name
	 * 2. Executing the action function
	 * 3. Processing the result through onBeforeActionResponse (if configured)
	 * 4. Handling timeouts and errors
	 * 5. Saving state changes
	 *
	 * @param ctx The action context
	 * @param actionName The name of the action being called
	 * @param args The arguments passed to the action
	 * @returns The result of the action call
	 * @throws {ActionNotFound} If the action doesn't exist
	 * @throws {ActionTimedOut} If the action times out
	 * @internal
	 */
	async executeAction(
		ctx: ActionContext<S, CP, CS, V, I, AD, DB>,
		actionName: string,
		args: unknown[],
	): Promise<unknown> {
		invariant(this.#ready, "executing action before ready");

		// Prevent calling private or reserved methods
		if (!(actionName in this.#config.actions)) {
			logger().warn("action does not exist", { actionName });
			throw new errors.ActionNotFound(actionName);
		}

		// Check if the method exists on this object
		const actionFunction = this.#config.actions[actionName];
		if (typeof actionFunction !== "function") {
			logger().warn("action is not a function", {
				actionName: actionName,
				type: typeof actionFunction,
			});
			throw new errors.ActionNotFound(actionName);
		}

		// TODO: pass abortable to the action to decide when to abort
		// TODO: Manually call abortable for better error handling
		// Call the function on this object with those arguments
		try {
			// Log when we start executing the action
			logger().debug("executing action", { actionName: actionName, args });

			const outputOrPromise = actionFunction.call(undefined, ctx, ...args);
			let output: unknown;
			if (outputOrPromise instanceof Promise) {
				// Log that we're waiting for an async action
				logger().debug("awaiting async action", { actionName: actionName });

				output = await deadline(
					outputOrPromise,
					this.#config.options.actionTimeout,
				);

				// Log that async action completed
				logger().debug("async action completed", { actionName: actionName });
			} else {
				output = outputOrPromise;
			}

			// Process the output through onBeforeActionResponse if configured
			if (this.#config.onBeforeActionResponse) {
				try {
					const processedOutput = this.#config.onBeforeActionResponse(
						this.actorContext,
						actionName,
						args,
						output,
					);
					if (processedOutput instanceof Promise) {
						logger().debug("awaiting onBeforeActionResponse", {
							actionName: actionName,
						});
						output = await processedOutput;
						logger().debug("onBeforeActionResponse completed", {
							actionName: actionName,
						});
					} else {
						output = processedOutput;
					}
				} catch (error) {
					logger().error("error in `onBeforeActionResponse`", {
						error: stringifyError(error),
					});
				}
			}

			// Log the output before returning
			logger().debug("action completed", {
				actionName: actionName,
				outputType: typeof output,
				isPromise: output instanceof Promise,
			});

			// This output *might* reference a part of the state (using onChange), but
			// that's OK since this value always gets serialized and sent over the
			// network.
			return output;
		} catch (error) {
			if (error instanceof DeadlineError) {
				throw new errors.ActionTimedOut();
			}
			logger().error("action error", {
				actionName: actionName,
				error: stringifyError(error),
			});
			throw error;
		} finally {
			this.#savePersistThrottled();
		}
	}

	/**
	 * Returns a list of action methods available on this actor.
	 */
	get actions(): string[] {
		return Object.keys(this.#config.actions);
	}

	/**
	 * Handles raw HTTP requests to the actor.
	 */
	async handleFetch(request: Request, opts: { auth: AD }): Promise<Response> {
		this.#assertReady();

		if (!this.#config.onFetch) {
			throw new errors.FetchHandlerNotDefined();
		}

		// Track active raw fetch while handler runs
		this.#activeRawFetchCount++;
		this.#resetSleepTimer();

		try {
			const response = await this.#config.onFetch(
				this.actorContext,
				request,
				opts,
			);
			if (!response) {
				throw new errors.InvalidFetchResponse();
			}
			return response;
		} catch (error) {
			logger().error("onFetch error", {
				error: stringifyError(error),
			});
			throw error;
		} finally {
			// Decrement active raw fetch counter and re-evaluate sleep
			this.#activeRawFetchCount = Math.max(0, this.#activeRawFetchCount - 1);
			this.#resetSleepTimer();
			this.#savePersistThrottled();
		}
	}

	/**
	 * Handles raw WebSocket connections to the actor.
	 */
	async handleWebSocket(
		websocket: UniversalWebSocket,
		opts: { request: Request; auth: AD },
	): Promise<void> {
		this.#assertReady();

		if (!this.#config.onWebSocket) {
			throw new errors.InternalError("onWebSocket handler not defined");
		}

		try {
			// Set up state tracking to detect changes during WebSocket handling
			const stateBeforeHandler = this.#persistChanged;

			// Track active websocket until it fully closes
			this.#activeRawWebSockets.add(websocket);
			this.#resetSleepTimer();

			// Track socket close
			const onSocketClosed = () => {
				// Remove listener and socket from tracking
				try {
					websocket.removeEventListener("close", onSocketClosed);
					websocket.removeEventListener("error", onSocketClosed);
				} catch {}
				this.#activeRawWebSockets.delete(websocket);
				this.#resetSleepTimer();
			};
			try {
				websocket.addEventListener("close", onSocketClosed);
				websocket.addEventListener("error", onSocketClosed);
			} catch {}

			// Handle WebSocket
			await this.#config.onWebSocket(this.actorContext, websocket, opts);

			// If state changed during the handler, save it
			if (this.#persistChanged && !stateBeforeHandler) {
				await this.saveState({ immediate: true });
			}
		} catch (error) {
			logger().error("onWebSocket error", {
				error: stringifyError(error),
			});
			throw error;
		} finally {
			this.#savePersistThrottled();
		}
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
	 * Gets the key.
	 */
	get key(): ActorKey {
		return this.#key;
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
	get conns(): Map<ConnId, Conn<S, CP, CS, V, I, AD, DB>> {
		return this.#connections;
	}

	/**
	 * Gets the current state.
	 *
	 * Changing properties of this value will automatically be persisted.
	 */
	get state(): S {
		this.#validateStateEnabled();
		return this.#persist.state;
	}

	/**
	 * Gets the database.
	 * @experimental
	 * @throws {DatabaseNotEnabled} If the database is not enabled.
	 */
	get db(): InferDatabaseClient<DB> {
		if (!this.#db) {
			throw new errors.DatabaseNotEnabled();
		}
		return this.#db;
	}

	/**
	 * Sets the current state.
	 *
	 * This property will automatically be persisted.
	 */
	set state(value: S) {
		this.#validateStateEnabled();
		this.#persist.state = value;
	}

	get vars(): V {
		this.#validateVarsEnabled();
		invariant(this.#vars !== undefined, "vars not enabled");
		return this.#vars;
	}

	/**
	 * Broadcasts an event to all connected clients.
	 * @param name - The name of the event.
	 * @param args - The arguments to send with the event.
	 */
	_broadcast<Args extends Array<unknown>>(name: string, ...args: Args) {
		this.#assertReady();

		this.inspector.emitter.emit("eventFired", {
			type: "broadcast",
			eventName: name,
			args,
		});

		// Send to all connected clients
		const subscriptions = this.#subscriptionIndex.get(name);
		if (!subscriptions) return;

		const toClientSerializer = new CachedSerializer<protocol.ToClient>(
			{
				body: {
					tag: "Event",
					val: {
						name,
						args: bufferToArrayBuffer(cbor.encode(args)),
					},
				},
			},
			TO_CLIENT_VERSIONED,
		);

		// Send message to clients
		for (const connection of subscriptions) {
			connection._sendMessage(toClientSerializer);
		}
	}

	/**
	 * Prevents the actor from sleeping until promise is complete.
	 *
	 * This allows the actor runtime to ensure that a promise completes while
	 * returning from an action request early.
	 *
	 * @param promise - The promise to run in the background.
	 */
	_waitUntil(promise: Promise<void>) {
		this.#assertReady();

		// TODO: Should we force save the state?
		// Add logging to promise and make it non-failable
		const nonfailablePromise = promise
			.then(() => {
				logger().debug("wait until promise complete");
			})
			.catch((error) => {
				logger().error("wait until promise failed", {
					error: stringifyError(error),
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
		this.#assertReady(opts.allowStoppingState);

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

	// MARK: Sleep
	/**
	 * Reset timer from the last actor interaction that allows it to be put to sleep.
	 *
	 * This should be called any time a sleep-related event happens:
	 * - Connection opens (will clear timer)
	 * - Connection closes (will schedule timer if there are no open connections)
	 * - Alarm triggers (will reset timer)
	 *
	 * We don't need to call this on events like individual action calls, since there will always be a connection open for these.
	 **/
	#resetSleepTimer() {
		if (this.#config.options.noSleep || !this.#sleepingSupported) return;

		const canSleep = this.#canSleep();

		logger().debug("resetting sleep timer", {
			canSleep,
			existingTimeout: !!this.#sleepTimeout,
		});

		if (this.#sleepTimeout) {
			clearTimeout(this.#sleepTimeout);
			this.#sleepTimeout = undefined;
		}

		// Don't set a new timer if already sleeping
		if (this.#sleepCalled) return;

		if (canSleep) {
			this.#sleepTimeout = setTimeout(() => {
				this._sleep().catch((error) => {
					logger().error("error during sleep", {
						error: stringifyError(error),
					});
				});
			}, this.#config.options.sleepTimeout);
		}
	}

	/** If this actor can be put in a sleeping state. */
	#canSleep(): boolean {
		if (!this.#ready) return false;

		// Check for active conns. This will also cover active actions, since all actions have a connection.
		for (const conn of this.#connections.values()) {
			if (conn.status === "connected") return false;
		}

		// Do not sleep if raw fetches are in-flight
		if (this.#activeRawFetchCount > 0) return false;

		// Do not sleep if there are raw websockets open
		if (this.#activeRawWebSockets.size > 0) return false;

		return true;
	}

	/** Puts an actor to sleep. This should just start the sleep sequence, most shutdown logic should be in _stop (which is called by the ActorDriver when sleeping). */
	async _sleep() {
		const sleep = this.#actorDriver.sleep?.bind(
			this.#actorDriver,
			this.#actorId,
		);
		invariant(this.#sleepingSupported, "sleeping not supported");
		invariant(sleep, "no sleep on driver");

		if (this.#sleepCalled) {
			logger().warn("already sleeping actor");
			return;
		}
		this.#sleepCalled = true;

		logger().info("actor sleeping");

		// Schedule sleep to happen on the next tick. This allows for any action that calls _sleep to complete.
		setImmediate(async () => {
			// The actor driver should call stop when ready to stop
			//
			// This will call _stop once Pegboard responds with the new status
			await sleep();
		});
	}

	// MARK: Stop
	async _stop() {
		if (this.#stopCalled) {
			logger().warn("already stopping actor");
			return;
		}
		this.#stopCalled = true;

		logger().info("actor stopping");

		// Abort any listeners waiting for shutdown
		try {
			this.#abortController.abort();
		} catch {}

		// Call onStop lifecycle hook if defined
		if (this.#config.onStop) {
			try {
				logger().debug("calling onStop");
				const result = this.#config.onStop(this.actorContext);
				if (result instanceof Promise) {
					await deadline(result, this.#config.options.onStopTimeout);
				}
				logger().debug("onStop completed");
			} catch (error) {
				if (error instanceof DeadlineError) {
					logger().error("onStop timed out");
				} else {
					logger().error("error in onStop", {
						error: stringifyError(error),
					});
				}
			}
		}

		// Disconnect existing connections
		const promises: Promise<unknown>[] = [];
		for (const connection of this.#connections.values()) {
			promises.push(connection.disconnect());

			// TODO: Figure out how to abort HTTP requests on shutdown
		}

		// Wait for any background tasks to finish, with timeout
		await this.#waitBackgroundPromises(this.#config.options.waitUntilTimeout);

		// Clear timeouts
		if (this.#pendingSaveTimeout) clearTimeout(this.#pendingSaveTimeout);
		if (this.#sleepTimeout) clearTimeout(this.#sleepTimeout);
		if (this.#checkConnLivenessInterval)
			clearInterval(this.#checkConnLivenessInterval);

		// Write state
		await this.saveState({ immediate: true, allowStoppingState: true });

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

		// Wait for queues to finish
		if (this.#persistWriteQueue.runningDrainLoop)
			await this.#persistWriteQueue.runningDrainLoop;
		if (this.#alarmWriteQueue.runningDrainLoop)
			await this.#alarmWriteQueue.runningDrainLoop;
	}

	/** Abort signal that fires when the actor is stopping. */
	get abortSignal(): AbortSignal {
		return this.#abortController.signal;
	}

	/** Wait for background waitUntil promises with a timeout. */
	async #waitBackgroundPromises(timeoutMs: number) {
		const pending = this.#backgroundPromises;
		if (pending.length === 0) {
			logger().debug("no background promises");
			return;
		}

		// Race promises with timeout to determine if pending promises settled fast enough
		const timedOut = await Promise.race([
			Promise.allSettled(pending).then(() => false),
			new Promise<true>((resolve) =>
				setTimeout(() => resolve(true), timeoutMs),
			),
		]);

		if (timedOut) {
			logger().error(
				"timed out waiting for background tasks, background promises may have leaked",
				{
					count: pending.length,
					timeoutMs,
				},
			);
		} else {
			logger().debug("background promises finished");
		}
	}

	// MARK: BARE Conversion Helpers
	#convertToBarePersisted(
		persist: PersistedActor<S, CP, CS, I>,
	): bareSchema.PersistedActor {
		return {
			input:
				persist.input !== undefined
					? bufferToArrayBuffer(cbor.encode(persist.input))
					: null,
			hasInitialized: persist.hasInitiated,
			state: bufferToArrayBuffer(cbor.encode(persist.state)),
			connections: persist.connections.map((conn) => ({
				id: conn.connId,
				token: conn.token,
				driver: conn.connDriver as string,
				driverState: bufferToArrayBuffer(
					cbor.encode(conn.connDriverState || {}),
				),
				parameters: bufferToArrayBuffer(cbor.encode(conn.params || {})),
				state: bufferToArrayBuffer(cbor.encode(conn.state || {})),
				auth:
					conn.authData !== undefined
						? bufferToArrayBuffer(cbor.encode(conn.authData))
						: null,
				subscriptions: conn.subscriptions.map((sub) => ({
					eventName: sub.eventName,
				})),
				lastSeen: BigInt(conn.lastSeen),
			})),
			scheduledEvents: persist.scheduledEvents.map((event) => ({
				eventId: event.eventId,
				timestamp: BigInt(event.timestamp),
				kind: {
					tag: "GenericPersistedScheduleEvent" as const,
					val: {
						action: event.kind.generic.actionName,
						args: event.kind.generic.args ?? null,
					},
				},
			})),
		};
	}

	#convertFromBarePersisted(
		bareData: bareSchema.PersistedActor,
	): PersistedActor<S, CP, CS, I> {
		return {
			input: bareData.input
				? cbor.decode(new Uint8Array(bareData.input))
				: undefined,
			hasInitiated: bareData.hasInitialized,
			state: cbor.decode(new Uint8Array(bareData.state)),
			connections: bareData.connections.map((conn) => ({
				connId: conn.id,
				token: conn.token,
				connDriver: conn.driver as ConnectionDriver,
				connDriverState: cbor.decode(new Uint8Array(conn.driverState)),
				params: cbor.decode(new Uint8Array(conn.parameters)),
				state: cbor.decode(new Uint8Array(conn.state)),
				authData: conn.auth
					? cbor.decode(new Uint8Array(conn.auth))
					: undefined,
				subscriptions: conn.subscriptions.map((sub) => ({
					eventName: sub.eventName,
				})),
				lastSeen: Number(conn.lastSeen),
			})),
			scheduledEvents: bareData.scheduledEvents.map((event) => ({
				eventId: event.eventId,
				timestamp: Number(event.timestamp),
				kind: {
					generic: {
						actionName: event.kind.val.action,
						args: event.kind.val.args,
					},
				},
			})),
		};
	}
}
