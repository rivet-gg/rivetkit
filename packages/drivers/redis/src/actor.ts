import type { ActorDriver, AnyActorInstance } from "actor-core/driver-helpers";
import type Redis from "ioredis";
import { KEYS } from "./keys";

export interface ActorDriverContext {
	redis: Redis;
}

export class RedisActorDriver implements ActorDriver {
	#redis: Redis;
	#alarms: Map<string, { timeout: NodeJS.Timeout, timestamp: number }>;

	constructor(redis: Redis) {
		this.#redis = redis;
		this.#alarms = new Map();
	}

	getContext(_actorId: string): ActorDriverContext {
		return { redis: this.#redis };
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
		const timeout = setTimeout(() => {
			this.#alarms.delete(actor.id);
			actor.onAlarm();
		}, delay);
		this.#alarms.set(actor.id, { timeout, timestamp });
	}

	async getAlarm(actor: AnyActorInstance): Promise<number | null> {
		const alarm = this.#alarms.get(actor.id);
		return alarm ? alarm.timestamp : null;
	}

	async deleteAlarm(actor: AnyActorInstance): Promise<void> {
		const alarm = this.#alarms.get(actor.id);
		if (alarm) {
			clearTimeout(alarm.timeout);
			this.#alarms.delete(actor.id);
		}
	}
}
