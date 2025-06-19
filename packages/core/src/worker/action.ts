import type { AnyWorkerInstance } from "./instance";
import type { Conn } from "./connection";
import type { Logger } from "@/common/log";
import type { WorkerKey } from "@/common/utils";
import type { Schedule } from "./schedule";
import type { ConnId } from "./connection";
import type { SaveStateOptions } from "./instance";
import { Actions } from "./config";
import { WorkerContext } from "./context";

/**
 * Context for a remote procedure call.
 *
 * @typeParam A Worker this action belongs to
 */
export class ActionContext<S, CP, CS, V, I, AD> {
	#workerContext: WorkerContext<S, CP, CS, V, I, AD>;

	/**
	 * Should not be called directly.
	 *
	 * @param workerContext - The worker context
	 * @param conn - The connection associated with the action
	 */
	constructor(
		workerContext: WorkerContext<S, CP, CS, V, I, AD>,
		public readonly conn: Conn<S, CP, CS, V, I, AD>,
	) {
		this.#workerContext = workerContext;
	}

	/**
	 * Get the worker state
	 */
	get state(): S {
		return this.#workerContext.state;
	}

	/**
	 * Get the worker variables
	 */
	get vars(): V {
		return this.#workerContext.vars;
	}

	/**
	 * Broadcasts an event to all connected clients.
	 */
	broadcast(name: string, ...args: any[]): void {
		this.#workerContext.broadcast(name, ...args);
	}

	/**
	 * Gets the logger instance.
	 */
	get log(): Logger {
		return this.#workerContext.log;
	}

	/**
	 * Gets worker ID.
	 */
	get workerId(): string {
		return this.#workerContext.workerId;
	}

	/**
	 * Gets the worker name.
	 */
	get name(): string {
		return this.#workerContext.name;
	}

	/**
	 * Gets the worker key.
	 */
	get key(): WorkerKey {
		return this.#workerContext.key;
	}

	/**
	 * Gets the region.
	 */
	get region(): string {
		return this.#workerContext.region;
	}

	/**
	 * Gets the scheduler.
	 */
	get schedule(): Schedule {
		return this.#workerContext.schedule;
	}

	/**
	 * Gets the map of connections.
	 */
	get conns(): Map<ConnId, Conn<S, CP, CS, V, I, AD>> {
		return this.#workerContext.conns;
	}

	/**
	 * Forces the state to get saved.
	 */
	async saveState(opts: SaveStateOptions): Promise<void> {
		return this.#workerContext.saveState(opts);
	}

	/**
	 * Runs a promise in the background.
	 */
	runInBackground(promise: Promise<void>): void {
		return this.#workerContext.runInBackground(promise);
	}
}
