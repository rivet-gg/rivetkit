import { Logger } from "@/common/log";
import { Actions } from "./config";
import { WorkerInstance, SaveStateOptions } from "./instance";
import { Conn, ConnId } from "./connection";
import { WorkerKey } from "@/common/utils";
import { Schedule } from "./schedule";

/**
 * WorkerContext class that provides access to worker methods and state
 */
export class WorkerContext<S, CP, CS, V, I, AD> {
	#worker: WorkerInstance<S, CP, CS, V, I, AD>;

	constructor(worker: WorkerInstance<S, CP, CS, V, I, AD>) {
		this.#worker = worker;
	}

	/**
	 * Get the worker state
	 */
	get state(): S {
		return this.#worker.state;
	}

	/**
	 * Get the worker variables
	 */
	get vars(): V {
		return this.#worker.vars;
	}

	/**
	 * Broadcasts an event to all connected clients.
	 * @param name - The name of the event.
	 * @param args - The arguments to send with the event.
	 */
	broadcast<Args extends Array<unknown>>(name: string, ...args: Args): void {
		this.#worker._broadcast(name, ...args);
		return;
	}

	/**
	 * Gets the logger instance.
	 */
	get log(): Logger {
		return this.#worker.log;
	}

	/**
	 * Gets worker ID.
	 */
	get workerId(): string {
		return this.#worker.id;
	}

	/**
	 * Gets the worker name.
	 */
	get name(): string {
		return this.#worker.name;
	}

	/**
	 * Gets the worker key.
	 */
	get key(): WorkerKey {
		return this.#worker.key;
	}

	/**
	 * Gets the region.
	 */
	get region(): string {
		return this.#worker.region;
	}

	/**
	 * Gets the scheduler.
	 */
	get schedule(): Schedule {
		return this.#worker.schedule;
	}

	/**
	 * Gets the map of connections.
	 */
	get conns(): Map<ConnId, Conn<S, CP, CS, V, I, AD>> {
		return this.#worker.conns;
	}

	/**
	 * Forces the state to get saved.
	 *
	 * @param opts - Options for saving the state.
	 */
	async saveState(opts: SaveStateOptions): Promise<void> {
		return this.#worker.saveState(opts);
	}

	/**
	 * Runs a promise in the background.
	 *
	 * @param promise - The promise to run in the background.
	 */
	runInBackground(promise: Promise<void>): void {
		this.#worker._runInBackground(promise);
		return;
	}
}
