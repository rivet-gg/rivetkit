import type {
	AnyActor,
	ExtractActorConnParams,
	ExtractActorConnState,
} from "./actor";
import * as errors from "../errors";
import { generateSecureToken } from "./utils";
import { CachedSerializer, Encoding } from "../protocol/serde";
import { logger } from "./log";
import { ConnectionDriver } from "./driver";
import * as messageToClient from "@/actor/protocol/message/to_client";

export function generateConnectionId(): string {
	return crypto.randomUUID();
}

export function generateConnectionToken(): string {
	return generateSecureToken(32);
}

export type ConnectionId = string;

/** Object representing connection that gets persisted to storage. */
export interface PersistedConn<A extends AnyActor> {
	// ID
	i: string;
	// Token
	t: string;
	// Connection driver
	d: string;
	// Connection driver state
	ds: unknown;
	// Parameters
	p: ExtractActorConnParams<A>;
	// State
	s: ExtractActorConnState<A>;
	// Subscriptions
	su: PersistedSub[];
}

export interface PersistedSub {
	// Event name
	n: string;
}

/**
 * Represents a client connection to an actor.
 *
 * Manages connection-specific data and controls the connection lifecycle.
 *
 * @see {@link https://rivet.gg/docs/connections|Connection Documentation}
 */
export class Connection<A extends AnyActor> {
	subscriptions: Set<string> = new Set<string>();

	#stateEnabled: boolean;

	// TODO: Remove this cyclical reference
	#actor: A;

	/**
	 * The proxied state that notifies of changes automatically.
	 *
	 * Any data that should be stored indefinitely should be held within this object.
	 */
	__persist: PersistedConn<A>;

	/**
	 * Driver used to manage realtime connection communication.
	 *
	 * @protected
	 */
	#driver: ConnectionDriver;

	public get parameters(): ExtractActorConnParams<A> {
		return this.__persist.p;
	}

	/**
	 * Gets the current state of the connection.
	 *
	 * Throws an error if the state is not enabled.
	 */
	public get state(): ExtractActorConnState<A> {
		this.#validateStateEnabled();
		if (!this.__persist.s) throw new Error("state should exists");
		return this.__persist.s;
	}

	/**
	 * Sets the state of the connection.
	 *
	 * Throws an error if the state is not enabled.
	 */
	public set state(value: ExtractActorConnState<A>) {
		this.#validateStateEnabled();
		this.__persist.s = value;
	}

	/**
	 * Unique identifier for the connection.
	 */
	public get id(): ConnectionId {
		return this.__persist.i;
	}

	/**
	 * Token used to authenticate this request.
	 */
	public get _token(): string {
		return this.__persist.t;
	}

	/**
	 * Initializes a new instance of the Connection class.
	 *
	 * This should only be constructed by {@link Actor}.
	 *
	 * @protected
	 */
	public constructor(
		actor: A,
		persist: PersistedConn<A>,
		driver: ConnectionDriver,
		stateEnabled: boolean,
	) {
		this.#actor = actor;
		this.__persist = persist;
		this.#driver = driver;
		this.#stateEnabled = stateEnabled;
	}

	#validateStateEnabled() {
		if (!this.#stateEnabled) {
			throw new errors.ConnectionStateNotEnabled();
		}
	}

	/**
	 * Sends a WebSocket message to the client.
	 *
	 * @param message - The message to send.
	 *
	 * @protected
	 */
	public _sendMessage(message: CachedSerializer<messageToClient.ToClient>) {
		this.#driver.sendMessage(this.#actor, this, this.__persist.ds, message);
	}

	/**
	 * Sends an event with arguments to the client.
	 *
	 * @param eventName - The name of the event.
	 * @param args - The arguments for the event.
	 * @see {@link https://rivet.gg/docs/events|Events Documentation}
	 */
	public send(eventName: string, ...args: unknown[]) {
		this._sendMessage(
			new CachedSerializer({
				b: {
					ev: {
						n: eventName,
						a: args,
					},
				},
			}),
		);
	}

	/**
	 * Disconnects the client with an optional reason.
	 *
	 * @param reason - The reason for disconnection.
	 */
	public async disconnect(reason?: string) {
		await this.#driver.disconnect(this.#actor, this, this.__persist.ds, reason);
	}
}
