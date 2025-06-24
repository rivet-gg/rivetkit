import * as crypto from "node:crypto";
import type {
	GetOrCreateWithKeyInput,
	GetForIdInput,
	GetWithKeyInput,
	ManagerDriver,
	WorkerOutput,
	CreateInput,
} from "@rivetkit/core/driver-helpers";
import { WorkerAlreadyExists } from "@rivetkit/core/errors";
import { logger } from "./log";
import type { FileSystemGlobalState } from "./global-state";
import { WorkerState } from "./global-state";
import type { Registry } from "@rivetkit/core";

export class FileSystemManagerDriver implements ManagerDriver {
	#state: FileSystemGlobalState;

	// inspector: ManagerInspector = new ManagerInspector(this, {
	// 	getAllWorkers: () => this.#state.getAllWorkers(),
	// 	getAllTypesOfWorkers: () => Object.keys(this.registry.config.workers),
	// });

	constructor(
		private readonly registry: Registry<any>,
		state: FileSystemGlobalState,
	) {
		this.#state = state;
	}

	async getForId({ workerId }: GetForIdInput): Promise<WorkerOutput | undefined> {
		// Validate the worker exists
		if (!this.#state.hasWorker(workerId)) {
			return undefined;
		}

		try {
			// Load worker state
			const state = this.#state.loadWorkerState(workerId);

			return {
				workerId,
				name: state.name,
				key: state.key,
			};
		} catch (error) {
			logger().error("failed to read worker state", { workerId, error });
			return undefined;
		}
	}

	async getWithKey({
		name,
		key,
	}: GetWithKeyInput): Promise<WorkerOutput | undefined> {
		// Search through all workers to find a match
		const worker = this.#state.findWorkerByNameAndKey(name, key);

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
		// First try to get the worker without locking
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
		await this.#state.createWorker(workerId, name, key, input);

		// Notify inspector about worker changes
		// this.inspector.onWorkersChange(this.#state.getAllWorkers());

		return {
			workerId,
			name,
			key,
		};
	}
}
