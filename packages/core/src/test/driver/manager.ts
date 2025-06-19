import type {
	GetForIdInput,
	GetWithKeyInput,
	GetOrCreateWithKeyInput,
	ManagerDriver,
	CreateInput,
} from "@/driver-helpers/mod";
import { WorkerAlreadyExists } from "@/worker/errors";
import type { TestGlobalState } from "./global-state";
import * as crypto from "node:crypto";
import { WorkerOutput } from "@/manager/driver";

export class TestManagerDriver implements ManagerDriver {
	#state: TestGlobalState;

	// inspector: ManagerInspector = new ManagerInspector(this, {
	// 	getAllWorkers: () => this.#state.getAllWorkers(),
	// 	getAllTypesOfWorkers: () => Object.keys(this.registry.config.workers),
	// });

	constructor(
		state: TestGlobalState,
	) {
		this.#state = state;
	}

	async getForId({ workerId }: GetForIdInput): Promise<WorkerOutput | undefined> {
		// Validate the worker exists
		const worker = this.#state.getWorker(workerId);
		if (!worker) {
			return undefined;
		}

		return {
			workerId,
			name: worker.name,
			key: worker.key,
		};
	}

	async getWithKey({
		name,
		key,
	}: GetWithKeyInput): Promise<WorkerOutput | undefined> {
		// NOTE: This is a slow implementation that checks each worker individually.
		// This can be optimized with an index in the future.

		const worker = this.#state.findWorker((worker) => {
			if (worker.name !== name) {
				return false;
			}

			// handle empty key
			if (key === null || key === undefined) {
				return worker.key === null || worker.key === undefined;
			}

			// handle array
			if (Array.isArray(key)) {
				if (!Array.isArray(worker.key)) {
					return false;
				}
				if (key.length !== worker.key.length) {
					return false;
				}
				// Check if all elements in key are in worker.key
				for (let i = 0; i < key.length; i++) {
					if (key[i] !== worker.key[i]) {
						return false;
					}
				}
				return true;
			}

			// Handle object
			if (typeof key === "object" && !Array.isArray(key)) {
				if (typeof worker.key !== "object" || Array.isArray(worker.key)) {
					return false;
				}
				if (worker.key === null) {
					return false;
				}

				// Check if all keys in key are in worker.key
				const keyObj = key as Record<string, unknown>;
				const workerKeyObj = worker.key as unknown as Record<string, unknown>;
				for (const k in keyObj) {
					if (!(k in workerKeyObj) || keyObj[k] !== workerKeyObj[k]) {
						return false;
					}
				}
				return true;
			}

			// handle scalar
			return key === worker.key;
		});

		if (worker) {
			return {
				workerId: worker.id,
				name,
				key: worker.key,
			};
		}

		return undefined;
	}

	async getOrCreateWithKey(
		input: GetOrCreateWithKeyInput,
	): Promise<WorkerOutput> {
		const getOutput = await this.getWithKey(input);
		if (getOutput) {
			return getOutput;
		} else {
			return await this.createWorker(input);
		}
	}

	async createWorker({ name, key, input }: CreateInput): Promise<WorkerOutput> {
		// Check if worker with the same name and key already exists
		const existingWorker = await this.getWithKey({ name, key });
		if (existingWorker) {
			throw new WorkerAlreadyExists(name, key);
		}

		const workerId = crypto.randomUUID();
		this.#state.createWorker(workerId, name, key, input);

		// this.inspector.onWorkersChange(this.#state.getAllWorkers());

		return {
			workerId,
			name,
			key,
		};
	}
}
