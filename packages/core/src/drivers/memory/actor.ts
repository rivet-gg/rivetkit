import type { ActorDriver, AnyActorInstance } from "@/driver-helpers/mod";
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

	async readPersistedData(actorId: string): Promise<Uint8Array | undefined> {
		return this.#state.readPersistedData(actorId);
	}

	async writePersistedData(actorId: string, data: Uint8Array): Promise<void> {
		this.#state.writePersistedData(actorId, data);
	}

	async setAlarm(actor: AnyActorInstance, timestamp: number): Promise<void> {
		const delay = Math.max(timestamp - Date.now(), 0);
		setTimeout(() => {
			actor.onAlarm();
		}, delay);
	}

	getDatabase(actorId: string): Promise<unknown | undefined> {
		return Promise.resolve(undefined);
	}
}
