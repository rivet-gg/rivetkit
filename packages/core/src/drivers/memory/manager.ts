import * as crypto from "node:crypto";
import { ActorAlreadyExists } from "@/actor/errors";
import type {
	ActorOutput,
	CreateInput,
	GetForIdInput,
	GetOrCreateWithKeyInput,
	GetWithKeyInput,
	ManagerDriver,
} from "@/driver-helpers/mod";
import type { MemoryGlobalState } from "./global-state";

export class MemoryManagerDriver implements ManagerDriver {
	#state: MemoryGlobalState;

	// inspector: ManagerInspector = new ManagerInspector(this, {
	// 	getAllActors: () => this.#state.getAllActors(),
	// 	getAllTypesOfActors: () => Object.keys(this.registry.config.actors),
	// });

	constructor(state: MemoryGlobalState) {
		this.#state = state;
	}

	async getForId({ actorId }: GetForIdInput): Promise<ActorOutput | undefined> {
		// Validate the actor exists
		const actor = this.#state.getActor(actorId);
		if (!actor) {
			return undefined;
		}

		return {
			actorId: actor.id,
			name: actor.name,
			key: actor.key,
		};
	}

	async getWithKey({
		name,
		key,
	}: GetWithKeyInput): Promise<ActorOutput | undefined> {
		// NOTE: This is a slow implementation that checks each actor individually.
		// This can be optimized with an index in the future.

		// Search through all actors to find a match
		const actor = this.#state.findActor((actor) => {
			if (actor.name !== name) return false;

			// If actor doesn't have a key, it's not a match
			if (!actor.key || actor.key.length !== key.length) {
				return false;
			}

			// Check if all elements in key are in actor.key
			for (let i = 0; i < key.length; i++) {
				if (key[i] !== actor.key[i]) {
					return false;
				}
			}
			return true;
		});

		if (actor) {
			return {
				actorId: actor.id,
				name,
				key: actor.key,
			};
		}

		return undefined;
	}

	async getOrCreateWithKey(
		input: GetOrCreateWithKeyInput,
	): Promise<ActorOutput> {
		const getOutput = await this.getWithKey(input);
		if (getOutput) {
			return getOutput;
		} else {
			return await this.createActor(input);
		}
	}

	async createActor({ name, key, input }: CreateInput): Promise<ActorOutput> {
		// Check if actor with the same name and key already exists
		const existingActor = await this.getWithKey({ name, key });
		if (existingActor) {
			throw new ActorAlreadyExists(name, key);
		}

		const actorId = crypto.randomUUID();
		this.#state.createActor(actorId, name, key, input);

		// this.inspector.onActorsChange(this.#state.getAllActors());

		return { actorId, name, key };
	}
}
