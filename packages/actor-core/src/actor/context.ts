import { Logger } from "@/common/log";
import { Actions } from "./config";
import { ActorInstance, SaveStateOptions } from "./instance";
import { Conn, ConnId } from "./connection";
import { ActorKey } from "@/common/utils";
import { Schedule } from "./schedule";


/**
 * ActorContext class that provides access to actor methods and state
 */
export class ActorContext<S, CP, CS, V> {
	#actor: ActorInstance<S, CP, CS, V>;

	constructor(actor: ActorInstance<S, CP, CS, V>) {
		this.#actor = actor;
	}

	/**
	 * Get the actor state
	 */
	get state(): S {
		return this.#actor.state;
	}

	/**
	 * Get the actor variables
	 */
	get vars(): V {
		return this.#actor.vars;
	}

	/**
	 * Broadcasts an event to all connected clients.
	 * @param name - The name of the event.
	 * @param args - The arguments to send with the event.
	 */
	broadcast<Args extends Array<unknown>>(name: string, ...args: Args): void {
		// @ts-ignore - Access protected method
		this.#actor._broadcast(name, ...args);
		return;
	}

	/**
	 * Gets the logger instance.
	 */
	get log(): Logger {
		// @ts-ignore - Access protected method
		return this.#actor.log;
	}

	/**
	 * Gets the actor name.
	 */
	get name(): string {
		// @ts-ignore - Access protected method
		return this.#actor.name;
	}

	/**
	 * Gets the actor key.
	 */
	get key(): ActorKey {
		// @ts-ignore - Access protected method
		return this.#actor.key;
	}

	/**
	 * Gets the region.
	 */
	get region(): string {
		// @ts-ignore - Access protected method
		return this.#actor.region;
	}

	/**
	 * Gets the scheduler.
	 */
	get schedule(): Schedule {
		// @ts-ignore - Access protected method
		return this.#actor.schedule;
	}

	/**
	 * Gets the map of connections.
	 */
	get conns(): Map<ConnId, Conn<S, CP, CS, V>> {
		// @ts-ignore - Access protected method
		return this.#actor.conns;
	}

	/**
	 * Forces the state to get saved.
	 *
	 * @param opts - Options for saving the state.
	 */
	async saveState(opts: SaveStateOptions): Promise<void> {
		// @ts-ignore - Access protected method
		return this.#actor.saveState(opts);
	}

	/**
	 * Runs a promise in the background.
	 *
	 * @param promise - The promise to run in the background.
	 */
	runInBackground(promise: Promise<void>): void {
		// @ts-ignore - Access protected method
		this.#actor._runInBackground(promise);
		return;
	}
}
