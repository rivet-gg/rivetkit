import type {
	ActorDriver,
	AnyActorInstance,
} from "@rivetkit/core/driver-helpers";
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

	async readPersistedData(actorId: string): Promise<Uint8Array | undefined> {
		const data = await this.#redis.getBuffer(KEYS.ACTOR.persistedData(actorId));
		if (data !== null) return data;
		return undefined;
	}

	async writePersistedData(actorId: string, data: Uint8Array): Promise<void> {
		await this.#redis.set(KEYS.ACTOR.persistedData(actorId), Buffer.from(data));
	}

	async setAlarm(actor: AnyActorInstance, timestamp: number): Promise<void> {
		const delay = Math.max(timestamp - Date.now(), 0);
		setTimeout(() => {
			actor.onAlarm();
		}, delay);
	}

	getDatabase(actorId: string): Promise<unknown | undefined> {
		// Redis does not have a database concept like other drivers, so we return undefined
		return Promise.resolve(undefined);
	}
}
