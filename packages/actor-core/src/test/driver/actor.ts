import type { ActorDriver, AnyActorInstance } from "@/driver-helpers/mod";
import type { TestGlobalState } from "./global_state";

export interface ActorDriverContext {
	// Used to test that the actor context works from tests
	isTest: boolean;
}

export class TestActorDriver implements ActorDriver {
	#state: TestGlobalState;
	#alarms: Map<string, { timeout: NodeJS.Timeout, timestamp: number }>;

	constructor(state: TestGlobalState) {
		this.#state = state;
		this.#alarms = new Map();
	}

	getContext(_actorId: string): ActorDriverContext {
		return {
			isTest: true,
		};
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
