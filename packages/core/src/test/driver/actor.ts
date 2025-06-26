import type { ActorDriver, AnyActorInstance } from "@/driver-helpers/mod";
import type { TestGlobalState } from "./global-state";

export interface ActorDriverContext {
	// Used to test that the actor context works from tests
	isTest: boolean;
}

export class TestActorDriver implements ActorDriver {
	#state: TestGlobalState;

	constructor(state: TestGlobalState) {
		this.#state = state;
	}

	getContext(_actorId: string): ActorDriverContext {
		return {
			isTest: true,
		};
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
