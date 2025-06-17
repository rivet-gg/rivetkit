import type {
	CreateInput,
	GetForIdInput,
	GetWithKeyInput,
	GetOrCreateWithKeyInput,
	WorkerOutput,
	ManagerDriver,
} from "rivetkit/driver-helpers";
import { WorkerAlreadyExists } from "rivetkit/errors";
import type { MemoryGlobalState } from "./global-state";
import * as crypto from "node:crypto";
import { ManagerInspector } from "rivetkit/inspector";
import type { Registry } from "rivetkit";

export class MemoryManagerDriver implements ManagerDriver {
	#state: MemoryGlobalState;

	/**
	 * @internal
	 */
	inspector: ManagerInspector = new ManagerInspector(this, {
		getAllWorkers: () => this.#state.getAllWorkers(),
		getAllTypesOfWorkers: () => Object.keys(this.registry.config.workers),
	});

	constructor(
		private readonly registry: Registry<any>,
		state: MemoryGlobalState,
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
			workerId: worker.id,
			name: worker.name,
			key: worker.key,
			meta: undefined,
		};
	}

	async getWithKey({
		name,
		key,
	}: GetWithKeyInput): Promise<WorkerOutput | undefined> {
		// NOTE: This is a slow implementation that checks each worker individually.
		// This can be optimized with an index in the future.

		// Search through all workers to find a match
		const worker = this.#state.findWorker((worker) => {
			if (worker.name !== name) return false;

			// If worker doesn't have a key, it's not a match
			if (!worker.key || worker.key.length !== key.length) {
				return false;
			}

			// Check if all elements in key are in worker.key
			for (let i = 0; i < key.length; i++) {
				if (key[i] !== worker.key[i]) {
					return false;
				}
			}
			return true;
		});

		if (worker) {
			return {
				workerId: worker.id,
				name,
				key: worker.key,
				meta: undefined,
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

		this.inspector.onWorkersChange(this.#state.getAllWorkers());

		return { workerId, name, key, meta: undefined };
	}
}
