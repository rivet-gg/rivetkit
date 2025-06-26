import type { ActorKey } from "@/actor/mod";
import { serializeEmptyPersistData } from "@/driver-helpers/mod";

export interface ActorState {
	id: string;
	name: string;
	key: ActorKey;
	persistedData?: Uint8Array;
}

export class TestGlobalState {
	#actors: Map<string, ActorState> = new Map();

	#getActor(actorId: string): ActorState {
		const actor = this.#actors.get(actorId);
		if (!actor) {
			throw new Error(`Actor does not exist for ID: ${actorId}`);
		}
		return actor;
	}

	readPersistedData(actorId: string): Uint8Array | undefined {
		return this.#getActor(actorId).persistedData;
	}

	writePersistedData(actorId: string, data: Uint8Array) {
		this.#getActor(actorId).persistedData = data;
	}

	createActor(
		actorId: string,
		name: string,
		key: ActorKey,
		input: unknown | undefined,
	): void {
		// Create actor state if it doesn't exist
		if (!this.#actors.has(actorId)) {
			this.#actors.set(actorId, {
				id: actorId,
				name,
				key,
				persistedData: serializeEmptyPersistData(input),
			});
		} else {
			throw new Error(`Actor already exists for ID: ${actorId}`);
		}
	}

	findActor(filter: (actor: ActorState) => boolean): ActorState | undefined {
		for (const actor of this.#actors.values()) {
			if (filter(actor)) {
				return actor;
			}
		}
		return undefined;
	}

	getActor(actorId: string): ActorState | undefined {
		return this.#actors.get(actorId);
	}

	getAllActors(): ActorState[] {
		return Array.from(this.#actors.values());
	}
}
