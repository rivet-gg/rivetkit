import type { WorkerDriver, AnyWorkerInstance } from "@/driver-helpers/mod";
import type { MemoryGlobalState } from "./global-state";

export type WorkerDriverContext = Record<never, never>;

export class MemoryWorkerDriver implements WorkerDriver {
	#state: MemoryGlobalState;

	constructor(state: MemoryGlobalState) {
		this.#state = state;
	}

	getContext(_workerId: string): WorkerDriverContext {
		return {};
	}

	async readInput(workerId: string): Promise<unknown | undefined> {
		return this.#state.readInput(workerId);
	}

	async readPersistedData(workerId: string): Promise<unknown | undefined> {
		return this.#state.readPersistedData(workerId);
	}

	async writePersistedData(workerId: string, data: unknown): Promise<void> {
		this.#state.writePersistedData(workerId, data);
	}

	async setAlarm(worker: AnyWorkerInstance, timestamp: number): Promise<void> {
		const delay = Math.max(timestamp - Date.now(), 0);
		setTimeout(() => {
			worker.onAlarm();
		}, delay);
	}
}
