import type { WorkerDriver, AnyWorkerInstance } from "@/driver-helpers/mod";
import type { TestGlobalState } from "./global-state";

export interface WorkerDriverContext {
	// Used to test that the worker context works from tests
	isTest: boolean;
}

export class TestWorkerDriver implements WorkerDriver {
	#state: TestGlobalState;

	constructor(state: TestGlobalState) {
		this.#state = state;
	}

	getContext(_workerId: string): WorkerDriverContext {
		return {
			isTest: true,
		};
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

	getDatabase(workerId: string): Promise<unknown | undefined> {
		return Promise.resolve(undefined);
	}
}
