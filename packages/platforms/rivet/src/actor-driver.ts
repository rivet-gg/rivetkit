import type { ActorContext } from "@rivet-gg/actor-core";
import type { ActorDriver, AnyActorInstance } from "actor-core/driver-helpers";

export interface ActorDriverContext {
	ctx: ActorContext;
}

export class RivetActorDriver implements ActorDriver {
	#ctx: ActorContext;

	constructor(ctx: ActorContext) {
		this.#ctx = ctx;
	}

	getContext(_actorId: string): ActorDriverContext {
		return { ctx: this.#ctx };
	}

	async readPersistedData(_actorId: string): Promise<unknown | undefined> {
		let data = await this.#ctx.kv.get(["actor-core", "data"]);

		// HACK: Modify to be undefined if null. This will be fixed in Actors v2.
		if (data === null) data = undefined;

		return data;
	}

	async writePersistedData(_actorId: string, data: unknown): Promise<void> {
		// Use "state" as the key for persisted data
		await this.#ctx.kv.put(["actor-core", "data"], data);
	}

	async setAlarm(actor: AnyActorInstance, timestamp: number): Promise<void> {
		const timeout = Math.max(0, timestamp - Date.now());
		setTimeout(() => {
			actor.onAlarm();
		}, timeout);
	}
}
