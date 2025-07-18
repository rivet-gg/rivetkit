import type { ActorKey } from "@/actor/mod";
import type { Client } from "@/client/client";
import type { Logger } from "@/common/log";
import type { Registry } from "@/registry/mod";
import type { Conn, ConnId } from "./connection";
import type { ActorContext } from "./context";
import type { SaveStateOptions } from "./instance";
import type { Schedule } from "./schedule";

/**
 * Context for a remote procedure call.
 *
 * @typeParam A Actor this action belongs to
 */
export class ActionContext<S, CP, CS, V, I, AD, DB> {
	#actorContext: ActorContext<S, CP, CS, V, I, AD, DB>;

	/**
	 * Should not be called directly.
	 *
	 * @param actorContext - The actor context
	 * @param conn - The connection associated with the action
	 */
	constructor(
		actorContext: ActorContext<S, CP, CS, V, I, AD, DB>,
		public readonly conn: Conn<S, CP, CS, V, I, AD, DB>,
	) {
		this.#actorContext = actorContext;
	}

	/**
	 * Get the actor state
	 */
	get state(): S {
		return this.#actorContext.state;
	}

	/**
	 * Get the actor variables
	 */
	get vars(): V {
		return this.#actorContext.vars;
	}

	/**
	 * Broadcasts an event to all connected clients.
	 */
	broadcast(name: string, ...args: any[]): void {
		this.#actorContext.broadcast(name, ...args);
	}

	/**
	 * Gets the logger instance.
	 */
	get log(): Logger {
		return this.#actorContext.log;
	}

	/**
	 * Gets actor ID.
	 */
	get actorId(): string {
		return this.#actorContext.actorId;
	}

	/**
	 * Gets the actor name.
	 */
	get name(): string {
		return this.#actorContext.name;
	}

	/**
	 * Gets the actor key.
	 */
	get key(): ActorKey {
		return this.#actorContext.key;
	}

	/**
	 * Gets the region.
	 */
	get region(): string {
		return this.#actorContext.region;
	}

	/**
	 * Gets the scheduler.
	 */
	get schedule(): Schedule {
		return this.#actorContext.schedule;
	}

	/**
	 * Gets the map of connections.
	 */
	get conns(): Map<ConnId, Conn<S, CP, CS, V, I, AD, DB>> {
		return this.#actorContext.conns;
	}

	/**
	 * Returns the client for the given registry.
	 */
	client<R extends Registry<any>>(): Client<R> {
		return this.#actorContext.client<R>();
	}

	/**
	 * @experimental
	 */
	get db(): DB {
		return this.#actorContext.db;
	}

	/**
	 * Forces the state to get saved.
	 */
	async saveState(opts: SaveStateOptions): Promise<void> {
		return this.#actorContext.saveState(opts);
	}

	/**
	 * Runs a promise in the background.
	 */
	runInBackground(promise: Promise<void>): void {
		this.#actorContext.runInBackground(promise);
	}
}
