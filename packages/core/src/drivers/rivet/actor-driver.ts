import { ActorContext } from "@rivet-gg/actor-core";
import type { ActorDriver, AnyActorInstance } from "@/driver-helpers/mod";

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

	async readInput(_actorId: string): Promise<unknown | undefined> {
		// Read input
		//
		// We need to have a separate exists flag in order to represent `undefined`
		const entries = await this.#ctx.kv.getBatch([
			["rivetkit", "input", "exists"],
			["rivetkit", "input", "data"],
		]);

		if (entries.get(["rivetkit", "input", "exists"]) === true) {
			return await entries.get(["rivetkit", "input", "data"]);
		} else {
			return undefined;
		}
	}

	async readPersistedData(_actorId: string): Promise<unknown | undefined> {
		let data = await this.#ctx.kv.get(["rivetkit", "data"]);

		// HACK: Modify to be undefined if null. This will be fixed in Actors v2.
		if (data === null) data = undefined;

		return data;
	}

	async writePersistedData(_actorId: string, data: unknown): Promise<void> {
		// Use "state" as the key for persisted data
		await this.#ctx.kv.put(["rivetkit", "data"], data);
	}

	async setAlarm(actor: AnyActorInstance, timestamp: number): Promise<void> {
		const timeout = Math.max(0, timestamp - Date.now());
		setTimeout(() => {
			actor.onAlarm();
		}, timeout);
	}

	getDatabase(_actorId: string): Promise<unknown | undefined> {
		// TODO: Implement database access
		return Promise.resolve(undefined);
	}
}
