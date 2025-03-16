import type { ActorDriver, KvKey, KvValue } from "actor-core/driver-helpers";
import type Redis from "ioredis";
import { KEYS } from "./keys";
import { AnyActorInstance } from "actor-core/driver-helpers";

export class RedisActorDriver implements ActorDriver {
    #redis: Redis;

    constructor(redis: Redis) {
        this.#redis = redis;
    }

    async kvGet(actorId: string, key: KvKey): Promise<KvValue | undefined> {
        const value = await this.#redis.get(this.#serializeKey(actorId, key));
        if (value !== null) return JSON.parse(value);
        return undefined;
    }

    async kvGetBatch(actorId: string, key: KvKey[]): Promise<(KvValue | undefined)[]> {
        const values = await this.#redis.mget(key.map((k) => this.#serializeKey(actorId, k)));
        return values.map((v) => {
            if (v !== null) return JSON.parse(v);
            return undefined;
        });
    }

    async kvPut(actorId: string, key: KvKey, value: KvValue): Promise<void> {
        await this.#redis.set(this.#serializeKey(actorId, key), JSON.stringify(value));
    }

    async kvPutBatch(actorId: string, key: [KvKey, KvValue][]): Promise<void> {
        await this.#redis.mset(
            Object.fromEntries(
                key.map(([k, v]) => [this.#serializeKey(actorId, k), JSON.stringify(v)]),
            ),
        );
    }

    async kvDelete(actorId: string, key: KvKey): Promise<void> {
        await this.#redis.del(this.#serializeKey(actorId, key));
    }

    async kvDeleteBatch(actorId: string, key: KvKey[]): Promise<void> {
        await this.#redis.del(key.map((k) => this.#serializeKey(actorId, k)));
    }

    async setAlarm(_actor: AnyActorInstance, _timestamp: number): Promise<void> {
        throw new Error("Alarms are not yet implemented for this driver.");
    }

    #serializeKey(actorId: string, key: KvKey): string {
        return KEYS.ACTOR.kv(actorId, typeof key === 'string' ? key : JSON.stringify(key));
    }
}
