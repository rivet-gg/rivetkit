import type {
	ManagerDriver,
	GetForIdInput,
	GetWithKeyInput,
	WorkerOutput,
	CreateInput,
	GetOrCreateWithKeyInput,
} from "@rivetkit/core/driver-helpers";
import { WorkerAlreadyExists } from "@rivetkit/core/errors";
import { Bindings } from "./mod";
import { logger } from "./log";
import { serializeNameAndKey, serializeKey } from "./util";
import { getCloudflareAmbientEnv } from "./handler";

// Worker metadata structure
interface WorkerData {
	name: string;
	key: string[];
}

// Key constants similar to Redis implementation
const KEYS = {
	WORKER: {
		// Combined key for worker metadata (name and key)
		metadata: (workerId: string) => `worker:${workerId}:metadata`,

		// Key index function for worker lookup
		keyIndex: (name: string, key: string[] = []) => {
			// Use serializeKey for consistent handling of all keys
			return `worker_key:${serializeKey(key)}`;
		},
	},
};

export class CloudflareWorkersManagerDriver implements ManagerDriver {
	async getForId({
		c,
		workerId,
	}: GetForIdInput<{ Bindings: Bindings }>): Promise<WorkerOutput | undefined> {
		const env = getCloudflareAmbientEnv();

		// Get worker metadata from KV (combined name and key)
		const workerData = (await env.WORKER_KV.get(KEYS.WORKER.metadata(workerId), {
			type: "json",
		})) as WorkerData | null;

		// If the worker doesn't exist, return undefined
		if (!workerData) {
			return undefined;
		}

		return {
			workerId,
			name: workerData.name,
			key: workerData.key,
		};
	}

	async getWithKey({
		c,
		name,
		key,
	}: GetWithKeyInput<{ Bindings: Bindings }>): Promise<
		WorkerOutput | undefined
	> {
		const env = getCloudflareAmbientEnv();

		logger().debug("getWithKey: searching for worker", { name, key });

		// Generate deterministic ID from the name and key
		// This is aligned with how createWorker generates IDs
		const nameKeyString = serializeNameAndKey(name, key);
		const workerId = env.WORKER_DO.idFromName(nameKeyString).toString();

		// Check if the worker metadata exists
		const workerData = await env.WORKER_KV.get(KEYS.WORKER.metadata(workerId), {
			type: "json",
		});

		if (!workerData) {
			logger().debug("getWithKey: no worker found with matching name and key", {
				name,
				key,
				workerId,
			});
			return undefined;
		}

		logger().debug("getWithKey: found worker with matching name and key", {
			workerId,
			name,
			key,
		});
		return this.#buildWorkerOutput(c, workerId);
	}

	async getOrCreateWithKey(
		input: GetOrCreateWithKeyInput,
	): Promise<WorkerOutput> {
		// TODO: Prevent race condition here
		const getOutput = await this.getWithKey(input);
		if (getOutput) {
			return getOutput;
		} else {
			return await this.createWorker(input);
		}
	}

	async createWorker({
		c,
		name,
		key,
		input,
	}: CreateInput<{ Bindings: Bindings }>): Promise<WorkerOutput> {
		const env = getCloudflareAmbientEnv();

		// Check if worker with the same name and key already exists
		const existingWorker = await this.getWithKey({ c, name, key });
		if (existingWorker) {
			throw new WorkerAlreadyExists(name, key);
		}

		// Create a deterministic ID from the worker name and key
		// This ensures that workers with the same name and key will have the same ID
		const nameKeyString = serializeNameAndKey(name, key);
		const doId = env.WORKER_DO.idFromName(nameKeyString);
		const workerId = doId.toString();

		// Init worker
		const worker = env.WORKER_DO.get(doId);
		await worker.initialize({
			name,
			key,
			input,
		});

		// Store combined worker metadata (name and key)
		const workerData: WorkerData = { name, key };
		await env.WORKER_KV.put(
			KEYS.WORKER.metadata(workerId),
			JSON.stringify(workerData),
		);

		// Add to key index for lookups by name and key
		await env.WORKER_KV.put(KEYS.WORKER.keyIndex(name, key), workerId);

		return {
			workerId,
			name,
			key,
		};
	}

	// Helper method to build worker output from an ID
	async #buildWorkerOutput(
		c: any,
		workerId: string,
	): Promise<WorkerOutput | undefined> {
		const env = getCloudflareAmbientEnv();

		const workerData = (await env.WORKER_KV.get(KEYS.WORKER.metadata(workerId), {
			type: "json",
		})) as WorkerData | null;

		if (!workerData) {
			return undefined;
		}

		return {
			workerId,
			name: workerData.name,
			key: workerData.key,
		};
	}
}
