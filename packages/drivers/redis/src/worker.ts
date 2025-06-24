import type { WorkerDriver, AnyWorkerInstance } from "@rivetkit/core/driver-helpers";
import type Redis from "ioredis";
import { KEYS } from "./keys";

export interface WorkerDriverContext {
	redis: Redis;
}

export class RedisWorkerDriver implements WorkerDriver {
	#redis: Redis;

	constructor(redis: Redis) {
		this.#redis = redis;
	}

	getContext(_workerId: string): WorkerDriverContext {
		return { redis: this.#redis };
	}

	async readInput(workerId: string): Promise<unknown | undefined> {
		// TODO: We should read this all in one batch, this will require multiple RTT to Redis
		const data = await this.#redis.get(KEYS.WORKER.input(workerId));
		if (data !== null) return JSON.parse(data);
		return undefined;
	}

	async readPersistedData(workerId: string): Promise<unknown | undefined> {
		const data = await this.#redis.get(KEYS.WORKER.persistedData(workerId));
		if (data !== null) return JSON.parse(data);
		return undefined;
	}

	async writePersistedData(workerId: string, data: unknown): Promise<void> {
		await this.#redis.set(
			KEYS.WORKER.persistedData(workerId),
			JSON.stringify(data),
		);
	}

	async setAlarm(worker: AnyWorkerInstance, timestamp: number): Promise<void> {
		const delay = Math.max(timestamp - Date.now(), 0);
		setTimeout(() => {
			worker.onAlarm();
		}, delay);
	}
}
