import type { ActorDriver, KvKey, KvValue } from "actor-core/driver-helpers";
import { GlobalState } from "./global_state";

export class MemoryActorDriver implements ActorDriver {
	#state: GlobalState;

	constructor() {
		this.#state = GlobalState.getInstance();
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

	async setAlarm(_actorId: string, timestamp: number): Promise<void> {
		setTimeout(() => {
			// TODO: This will need to be updated to call the actor from the topology
			// actorTopology.actor.__onAlarm();
		}, timestamp - Date.now());
	}

	// Simple key serialization without depending on keys.ts
	#serializeKey(key: KvKey): string {
		return JSON.stringify(key);
	}
}
