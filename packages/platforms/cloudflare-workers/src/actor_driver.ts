import { ActorDriver, KvKey, KvValue, AnyActorInstance } from "actor-core/driver-helpers";

export interface ActorDriverContext {
	ctx: DurableObjectState;
	env: unknown;
}

export class CloudflareWorkersActorDriver implements ActorDriver {
	#doCtx: DurableObjectState;
	#env: unknown;

	constructor(ctx: DurableObjectState, env: unknown) {
		this.#doCtx = ctx;
		this.#env = env;
	}

	get context(): ActorDriverContext {
		return { ctx: this.#doCtx, env: this.#env };
	}

	async kvGet(_actorId: string, key: KvKey): Promise<KvValue | undefined> {
		return await this.#doCtx.storage.get(this.#serializeKey(key));
	}

	async kvGetBatch(
		_actorId: string,
		keys: KvKey[],
	): Promise<(KvValue | undefined)[]> {
		const resultMap = await this.#doCtx.storage.get(
			keys.map(this.#serializeKey),
		);
		return keys.map((key) => resultMap.get(this.#serializeKey(key)));
	}

	async kvPut(_actorId: string, key: KvKey, value: KvValue): Promise<void> {
		await this.#doCtx.storage.put(this.#serializeKey(key), value);
	}

	async kvPutBatch(
		_actorId: string,
		entries: [KvKey, KvValue][],
	): Promise<void> {
		await this.#doCtx.storage.put(
			Object.fromEntries(entries.map(([k, v]) => [this.#serializeKey(k), v])),
		);
	}

	async kvDelete(_actorId: string, key: KvKey): Promise<void> {
		await this.#doCtx.storage.delete(this.#serializeKey(key));
	}

	async kvDeleteBatch(_actorId: string, keys: KvKey[]): Promise<void> {
		await this.#doCtx.storage.delete(keys.map(this.#serializeKey));
	}

	async setAlarm(_actor: AnyActorInstance, timestamp: number): Promise<void> {
		await this.#doCtx.storage.setAlarm(timestamp);
	}

	#serializeKey(key: KvKey): string {
		return JSON.stringify(key);
	}
}
