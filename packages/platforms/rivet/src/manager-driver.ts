import { assertUnreachable } from "rivetkit/utils";
import { WorkerAlreadyExists, InternalError } from "rivetkit/errors";
import type {
	ManagerDriver,
	GetForIdInput,
	GetWithKeyInput,
	WorkerOutput,
	GetOrCreateWithKeyInput,
	CreateInput,
} from "rivetkit/driver-helpers";
import { logger } from "./log";
import {
	RivetActor,
	type RivetClientConfig,
	rivetRequest,
} from "./rivet-client";
import {
	serializeKeyForTag,
	deserializeKeyFromTag,
	convertKeyToRivetTags,
} from "./util";
import {
	getWorkerMeta,
	getWorkerMetaWithKey,
	populateCache,
} from "./worker-meta";
import invariant from "invariant";

export interface WorkerState {
	key: string[];
	destroyedAt?: number;
}

export interface GetWorkerMeta {
	endpoint: string;
}

export class RivetManagerDriver implements ManagerDriver {
	#clientConfig: RivetClientConfig;

	constructor(clientConfig: RivetClientConfig) {
		this.#clientConfig = clientConfig;
	}

	async getForId({
		workerId,
	}: GetForIdInput): Promise<WorkerOutput | undefined> {
		try {
			const meta = await getWorkerMeta(this.#clientConfig, workerId);
			if (!meta) return undefined;

			return {
				workerId,
				name: meta.name,
				key: meta.key,
			};
		} catch (error) {
			// TODO: Handle not found or other errors gracefully
			return undefined;
		}
	}

	async getWithKey({
		name,
		key,
	}: GetWithKeyInput): Promise<WorkerOutput | undefined> {
		const meta = await getWorkerMetaWithKey(this.#clientConfig, name, key);
		if (!meta) return undefined;

		return {
			workerId: meta.workerId,
			name: meta.name,
			key: meta.key,
		};
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

	async createWorker({
		name,
		key,
		region,
		input,
	}: CreateInput): Promise<WorkerOutput> {
		// Check if worker with the same name and key already exists
		const existingWorker = await this.getWithKey({ name, key });
		if (existingWorker) {
			throw new WorkerAlreadyExists(name, key);
		}

		// Create the worker request
		let workerLogLevel: string | undefined = undefined;
		if (typeof Deno !== "undefined") {
			workerLogLevel = Deno.env.get("_WORKER_LOG_LEVEL");
		} else if (typeof process !== "undefined") {
			// Do this after Deno since `process` is sometimes polyfilled
			workerLogLevel = process.env._WORKER_LOG_LEVEL;
		}

		const createRequest = {
			tags: convertKeyToRivetTags(name, key),
			build_tags: {
				role: "worker",
				framework: "rivetkit",
				current: "true",
			},
			region,
			network: {
				ports: {
					http: {
						protocol: "https",
						routing: { guard: {} },
					},
				},
			},
			runtime: {
				environment: workerLogLevel
					? {
							_LOG_LEVEL: workerLogLevel,
						}
					: {},
			},
			lifecycle: {
				durable: true,
			},
		};

		logger().info("creating actor", { ...createRequest });

		// Create the worker
		const { actor } = await rivetRequest<
			typeof createRequest,
			{ actor: RivetActor }
		>(this.#clientConfig, "POST", "/actors", createRequest);

		const meta = populateCache(actor);
		invariant(meta, "actor just created, should not be destroyed");

		// Initialize the worker
		try {
			const url = `${meta.endpoint}/initialize`;
			logger().debug("initializing worker", {
				url,
				input: JSON.stringify(input),
			});

			const res = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ input }),
			});
			if (!res.ok) {
				throw new InternalError(
					`Worker initialize request failed (${res.status}):\n${await res.text()}`,
				);
			}
		} catch (error) {
			logger().error("failed to initialize worker, destroying worker", {
				workerId: actor.id,
				error,
			});

			// Destroy the worker since it failed to initialize
			await rivetRequest<typeof createRequest, { worker: RivetActor }>(
				this.#clientConfig,
				"DELETE",
				`/actors/${actor.id}`,
			);

			throw error;
		}

		return {
			workerId: actor.id,
			name: meta.name,
			key: meta.key,
		};
	}
}
