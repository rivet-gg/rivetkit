import type { AnyActorInstance } from "./instance";
import type { Conn } from "./connection";
import type { Logger } from "@/common/log";
import type { ActorTags } from "@/common/utils";
import type { Schedule } from "./schedule";
import type { ConnId } from "./connection";
import type { SaveStateOptions } from "./instance";
import { Actions } from "./config";
import { ActorContext } from "./context";

/**
 * Options for the `_broadcast` method.
 */
interface BroadcastOptions {
	/**
	 * The connection IDs to be excluded from the broadcast.
	 */
	exclude?: ConnId[];
	/**
	 * Excludes the current connection from the broadcast.
	 */
	excludeSelf?: boolean;
}

/**
 * Context for a remote procedure call.
 *
 * @typeParam A Actor this action belongs to
 */
export class ActionContext<S, CP, CS, V> {
	#actorContext: ActorContext<S, CP, CS, V>;

	/**
	 * Should not be called directly.
	 *
	 * @param actorContext - The actor context
	 * @param conn - The connection associated with the action
	 */
	constructor(
		actorContext: ActorContext<S, CP, CS, V>,
		public readonly conn: Conn<S, CP, CS, V>,
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
	 * Broadcasts an event to all connected clients with options.
	 */
	broadcastWithOptions<Args extends Array<unknown>>(opts: BroadcastOptions, name: string, ...args: Args) {
		const exclude = opts.exclude ?? [];

		if (opts.excludeSelf) {
			exclude.push(this.conn.id);
		}

		// @ts-ignore - Access protected method
		this.#actorContext.broadcastWithOptions({ exclude }, name, ...args);
		return;
	}

	/**
	 * Alias for `broadcastWithOptions`
	 */
	broadcastWith<Args extends Array<unknown>>(opts: BroadcastOptions, name: string, ...args: Args) {
		return this.broadcastWithOptions(opts, name, ...args);
	}

	/**
	 * Gets the logger instance.
	 */
	get log(): Logger {
		return this.#actorContext.log;
	}

	/**
	 * Gets the actor name.
	 */
	get name(): string {
		return this.#actorContext.name;
	}

	/**
	 * Gets the actor tags.
	 */
	get tags(): ActorTags {
		return this.#actorContext.tags;
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
	get conns(): Map<ConnId, Conn<S, CP, CS, V>> {
		return this.#actorContext.conns;
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
		return this.#actorContext.runInBackground(promise);
	}
}
