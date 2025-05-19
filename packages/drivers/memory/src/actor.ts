import type { ActorDriver, AnyActorInstance } from "actor-core/driver-helpers";
import type { MemoryGlobalState } from "./global-state";

export type ActorDriverContext = Record<never, never>;

export class MemoryActorDriver implements ActorDriver {
	#state: MemoryGlobalState;

	constructor(state: MemoryGlobalState) {
		this.#state = state;
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
		setTimeout(() => {
			actor.onAlarm();
		}, delay);
	}
}
