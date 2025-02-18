import type { ActorContext } from "@rivet-gg/actor-core";
import { ActorDriver, KvKey, KvValue } from "actor-core/driver-helpers";

export class RivetActorDriver implements ActorDriver {
	#ctx: ActorContext;

	constructor(ctx: ActorContext) {
		this.#ctx = ctx;
	}

	async kvGet(_actorId: string, key: KvKey): Promise<KvValue | undefined> {
		return await this.#ctx.kv.get(key);
	}

	async kvGetBatch(
		_actorId: string, 
		keys: KvKey[]
	): Promise<(KvValue | undefined)[]> {
		const response = await this.#ctx.kv.getBatch(keys);
		return keys.map(key => response.get(key));
	}

	async kvPut(_actorId: string, key: KvKey, value: KvValue): Promise<void> {
		await this.#ctx.kv.put(key, value);
	}

	async kvPutBatch(
		_actorId: string,
		entries: [KvKey, KvValue][]
	): Promise<void> {
		await this.#ctx.kv.putBatch(new Map(entries));
	}

	async kvDelete(_actorId: string, key: KvKey): Promise<void> {
		await this.#ctx.kv.delete(key);
	}

	async kvDeleteBatch(_actorId: string, keys: KvKey[]): Promise<void> {
		await this.#ctx.kv.deleteBatch(keys);
	}

	async setAlarm(_actorId: string, timestamp: number): Promise<void> {
		const timeout = Math.max(0, timestamp - Date.now());
		setTimeout(() => {
			// TODO: This will need to be updated to call the actor from the topology
			// actorTopology.actor.__onAlarm();
		}, timeout);
	}
}
