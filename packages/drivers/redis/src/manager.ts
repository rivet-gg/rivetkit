import type {
	CreateInput,
	WorkerOutput,
	GetForIdInput,
	GetOrCreateWithKeyInput,
	GetWithKeyInput,
	ManagerDriver,
} from "rivetkit/driver-helpers";
import { WorkerAlreadyExists } from "rivetkit/errors";
import type Redis from "ioredis";
import * as crypto from "node:crypto";
import { KEYS } from "./keys";
import type { Registry } from "rivetkit";

interface Worker {
	id: string;
	name: string;
	key: string[];
	region?: string;
	createdAt?: string;
	destroyedAt?: string;
}

export class RedisManagerDriver implements ManagerDriver {
	#redis: Redis;
	#registry?: Registry<any>;

	// inspector: ManagerInspector = new ManagerInspector(this, {
	// 	getAllWorkers: () => {
	// 		// Create a function that returns an array of workers directly
	// 		// Not returning a Promise since the ManagerInspector expects a synchronous function
	// 		const workers: Worker[] = [];
	//
	// 		// Return empty array since we can't do async operations here
	// 		// The actual data will be fetched when needed by calling getAllWorkers() manually
	// 		return workers;
	// 	},
	// 	getAllTypesOfWorkers: () => {
	// 		if (!this.#registry) return [];
	// 		return Object.keys(this.#registry.config.workers);
	// 	},
	// });

	constructor(redis: Redis, registry?: Registry<any>) {
		this.#redis = redis;
		this.#registry = registry;
	}

	async getForId({ workerId }: GetForIdInput): Promise<WorkerOutput | undefined> {
		// Get metadata from Redis
		const metadataStr = await this.#redis.get(KEYS.WORKER.metadata(workerId));

		// If the worker doesn't exist, return undefined
		if (!metadataStr) {
			return undefined;
		}

		const metadata = JSON.parse(metadataStr);
		const { name, key } = metadata;

		return {
			workerId,
			name,
			key,
		};
	}

	async getWithKey({
		name,
		key,
	}: GetWithKeyInput): Promise<WorkerOutput | undefined> {
		// Since keys are 1:1 with worker IDs, we can directly look up by key
		const lookupKey = this.#generateWorkerKeyRedisKey(name, key);
		const workerId = await this.#redis.get(lookupKey);

		if (!workerId) {
			return undefined;
		}

		return this.getForId({ workerId });
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

	async createWorker({ name, key, input }: CreateInput): Promise<WorkerOutput> {
		// Check if worker with the same name and key already exists
		const existingWorker = await this.getWithKey({ name, key });
		if (existingWorker) {
			throw new WorkerAlreadyExists(name, key);
		}

		const workerId = crypto.randomUUID();
		const workerKeyRedisKey = this.#generateWorkerKeyRedisKey(name, key);

		// Use a transaction to ensure all operations are atomic
		const pipeline = this.#redis.multi();

		// Store basic worker information
		pipeline.set(KEYS.WORKER.initialized(workerId), "1");
		pipeline.set(KEYS.WORKER.metadata(workerId), JSON.stringify({ name, key }));
		pipeline.set(KEYS.WORKER.input(workerId), JSON.stringify(input));

		// Create direct lookup by name+key -> workerId
		pipeline.set(workerKeyRedisKey, workerId);

		// Execute all commands atomically
		await pipeline.exec();

		// Notify inspector of worker creation
		// this.inspector.onWorkersChange([
		// 	{
		// 		id: workerId,
		// 		name,
		// 		key,
		// 	},
		// ]);

		return {
			workerId,
			name,
			key,
		};
	}

	// Helper method to get all workers (for inspector)
	private async getAllWorkers(): Promise<Worker[]> {
		const keys = await this.#redis.keys(
			KEYS.WORKER.metadata("*").replace(/:metadata$/, ""),
		);
		const workerIds = keys.map((key) => key.split(":")[1]);

		const workers: Worker[] = [];
		for (const workerId of workerIds) {
			const metadataStr = await this.#redis.get(KEYS.WORKER.metadata(workerId));

			if (metadataStr) {
				const metadata = JSON.parse(metadataStr);
				workers.push({
					id: workerId,
					name: metadata.name,
					key: metadata.key || [],
				});
			}
		}

		return workers;
	}

	// Generate a Redis key for looking up a worker by name+key
	#generateWorkerKeyRedisKey(name: string, key: string[]): string {
		// Base prefix for worker key lookups
		let redisKey = `worker_by_key:${this.#escapeRedisKey(name)}`;

		// Add each key component with proper escaping
		if (key.length > 0) {
			redisKey += `:${key.map((k) => this.#escapeRedisKey(k)).join(":")}`;
		}

		return redisKey;
	}

	// Escape special characters in Redis keys
	// Redis keys shouldn't contain spaces or control characters
	// and we need to escape the delimiter character (:)
	#escapeRedisKey(part: string): string {
		return part
			.replace(/\\/g, "\\\\") // Escape backslashes first
			.replace(/:/g, "\\:"); // Escape colons (our delimiter)
	}
}
