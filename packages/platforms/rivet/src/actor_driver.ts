import type { ActorContext } from "@rivet-gg/actor-core";
import type { ActorDriver, AnyActorInstance } from "actor-core/driver-helpers";

export interface ActorDriverContext {
	ctx: ActorContext;
}

export class RivetActorDriver implements ActorDriver {
	#ctx: ActorContext;
	#alarms: Map<string, { timeout: NodeJS.Timeout, timestamp: number }>;

	constructor(ctx: ActorContext) {
		this.#ctx = ctx;
		this.#alarms = new Map();
	}

	getContext(_actorId: string): ActorDriverContext {
		return { ctx: this.#ctx };
	}

	async readPersistedData(_actorId: string): Promise<unknown | undefined> {
		// Use "state" as the key for persisted data
		return await this.#ctx.kv.get(["actor-core", "data"]);
	}

	async writePersistedData(_actorId: string, data: unknown): Promise<void> {
		// Use "state" as the key for persisted data
		await this.#ctx.kv.put(["actor-core", "data"], data);
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
