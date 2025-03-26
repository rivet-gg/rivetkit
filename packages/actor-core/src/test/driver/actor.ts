import type { ActorDriver, KvKey, KvValue, AnyActorInstance } from "@/driver-helpers/mod";
import type { TestGlobalState } from "./global_state";

export interface ActorDriverContext {
	state: TestGlobalState;
}

export class TestActorDriver implements ActorDriver {
	#state: TestGlobalState;

	constructor(state: TestGlobalState) {
		this.#state = state;
	}

	get context(): ActorDriverContext {
		return { state: this.#state };
	}

	async kvGet(actorId: string, key: KvKey): Promise<KvValue | undefined> {
		const serializedKey = this.#serializeKey(key);
		const value = this.#state.getKv(actorId, serializedKey);

		if (value !== undefined) return JSON.parse(value);
		return undefined;
	}

	async kvGetBatch(
		actorId: string,
		keys: KvKey[],
	): Promise<(KvValue | undefined)[]> {
		return keys.map((key) => {
			const serializedKey = this.#serializeKey(key);
			const value = this.#state.getKv(actorId, serializedKey);
			if (value !== undefined) return JSON.parse(value);
			return undefined;
		});
	}

	async kvPut(actorId: string, key: KvKey, value: KvValue): Promise<void> {
		const serializedKey = this.#serializeKey(key);
		this.#state.putKv(actorId, serializedKey, JSON.stringify(value));
	}

	async kvPutBatch(
		actorId: string,
		keyValuePairs: [KvKey, KvValue][],
	): Promise<void> {
		for (const [key, value] of keyValuePairs) {
			const serializedKey = this.#serializeKey(key);
			this.#state.putKv(actorId, serializedKey, JSON.stringify(value));
		}
	}

	async kvDelete(actorId: string, key: KvKey): Promise<void> {
		const serializedKey = this.#serializeKey(key);
		this.#state.deleteKv(actorId, serializedKey);
	}

	async kvDeleteBatch(actorId: string, keys: KvKey[]): Promise<void> {
		for (const key of keys) {
			const serializedKey = this.#serializeKey(key);
			this.#state.deleteKv(actorId, serializedKey);
		}
	}

	async setAlarm(actor: AnyActorInstance, timestamp: number): Promise<void> {
		setTimeout(() => {
			actor.onAlarm();
		}, timestamp - Date.now());
	}

	// Simple key serialization without depending on keys.ts
	#serializeKey(key: KvKey): string {
		return JSON.stringify(key);
	}
}
