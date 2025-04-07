import type { ActorDriver, AnyActorInstance } from "@/driver-helpers/mod";
import type { TestGlobalState } from "./global_state";

export type ActorDriverContext = Record<never, never>;

export class TestActorDriver implements ActorDriver {
	#state: TestGlobalState;

	constructor(state: TestGlobalState) {
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
		setTimeout(() => {
			actor.onAlarm();
		}, timestamp - Date.now());
	}
}
