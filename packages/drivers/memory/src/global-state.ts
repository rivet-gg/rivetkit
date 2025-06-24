import type { WorkerKey } from "@rivetkit/core";

export interface WorkerState {
	id: string;
	name: string;
	key: WorkerKey;
	persistedData: unknown;
	input?: unknown;
}

export class MemoryGlobalState {
	#workers: Map<string, WorkerState> = new Map();

	#getWorker(workerId: string): WorkerState {
		const worker = this.#workers.get(workerId);
		if (!worker) {
			throw new Error(`Worker does not exist for ID: ${workerId}`);
		}
		return worker;
	}

	readInput(workerId: string): unknown | undefined {
		return this.#getWorker(workerId).input;
	}

	readPersistedData(workerId: string): unknown | undefined {
		return this.#getWorker(workerId).persistedData;
	}

	writePersistedData(workerId: string, data: unknown) {
		this.#getWorker(workerId).persistedData = data;
	}

	createWorker(
		workerId: string,
		name: string,
		key: WorkerKey,
		input?: unknown,
	): void {
		// Create worker state if it doesn't exist
		if (!this.#workers.has(workerId)) {
			this.#workers.set(workerId, {
				id: workerId,
				name,
				key,
				persistedData: undefined,
				input,
			});
		} else {
			throw new Error(`Worker already exists for ID: ${workerId}`);
		}
	}

	findWorker(filter: (worker: WorkerState) => boolean): WorkerState | undefined {
		for (const worker of this.#workers.values()) {
			if (filter(worker)) {
				return worker;
			}
		}
		return undefined;
	}

	getWorker(workerId: string): WorkerState | undefined {
		return this.#workers.get(workerId);
	}

	getAllWorkers(): WorkerState[] {
		return Array.from(this.#workers.values());
	}
}
