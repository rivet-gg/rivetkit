import type { ActorDriver, AnyActorInstance } from "actor-core/driver-helpers";
import type Redis from "ioredis";
import { KEYS } from "./keys";

export interface ActorDriverContext {
	redis: Redis;
}

export class RedisActorDriver implements ActorDriver {
	#redis: Redis;

	constructor(redis: Redis) {
		this.#redis = redis;
	}

	getContext(_actorId: string): ActorDriverContext {
		return { redis: this.#redis };
	}

	async readInput(actorId: string): Promise<unknown | undefined> {
		// TODO: We should read this all in one batch, this will require multiple RTT to Redis
		const data = await this.#redis.get(KEYS.ACTOR.input(actorId));
		if (data !== null) return JSON.parse(data);
		return undefined;
	}

	async readPersistedData(actorId: string): Promise<unknown | undefined> {
		const data = await this.#redis.get(KEYS.ACTOR.persistedData(actorId));
		if (data !== null) return JSON.parse(data);
		return undefined;
	}

	async writePersistedData(actorId: string, data: unknown): Promise<void> {
		await this.#redis.set(
			KEYS.ACTOR.persistedData(actorId),
			JSON.stringify(data),
		);
	}

	async setAlarm(actor: AnyActorInstance, timestamp: number): Promise<void> {
		const delay = Math.max(timestamp - Date.now(), 0);
		setTimeout(() => {
			actor.onAlarm();
		}, delay);
	}
}
