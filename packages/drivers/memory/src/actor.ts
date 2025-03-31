import type { ActorDriver, AnyActorInstance } from "actor-core/driver-helpers";
import type { MemoryGlobalState } from "./global_state";

export type ActorDriverContext = Record<never, never>;

export class MemoryActorDriver implements ActorDriver {
	#state: MemoryGlobalState;
	#alarms: Map<string, { timeout: NodeJS.Timeout, timestamp: number }>;

	constructor(state: MemoryGlobalState) {
		this.#state = state;
		this.#alarms = new Map();
	}

	getContext(_actorId: string): ActorDriverContext {
		return {};
	}

	async readPersistedData(actorId: string): Promise<unknown | undefined> {
		return this.#state.readPersistedData(actorId);
	}

	async writePersistedData(actorId: string, data: unknown): Promise<void> {
		this.#state.writePersistedData(actorId, data);
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
