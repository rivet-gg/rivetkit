import { Logger } from "@/common/log";
import { Rpcs } from "./config";
import { ActorInstance, SaveStateOptions } from "./instance";
import { Connection, ConnectionId } from "./connection";
import { ActorTags } from "@/common/utils";
import { Schedule } from "./schedule";


/**
 * ActorContext class that provides access to actor methods and state
 */
export class ActorContext<S, CP, CS> {
	#actor: ActorInstance<S, CP, CS>;

	constructor(actor: ActorInstance<S, CP, CS>) {
		this.#actor = actor;
	}

	/**
	 * Get the actor state
	 */
	get state(): S {
		return this.#actor.state;
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
	 * Gets the actor tags.
	 */
	get tags(): ActorTags {
		// @ts-ignore - Access protected method
		return this.#actor.tags;
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
	get connections(): Map<ConnectionId, Connection<S, CP, CS>> {
		// @ts-ignore - Access protected method
		return this.#actor.connections;
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
