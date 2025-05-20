import type {
	CreateActorInput,
	CreateActorOutput,
	GetActorOutput,
	GetForIdInput,
	GetWithKeyInput,
	ManagerDriver,
} from "actor-core/driver-helpers";
import { ActorAlreadyExists } from "actor-core/errors";
import type { MemoryGlobalState } from "./global-state";
import * as crypto from "node:crypto";
import { ManagerInspector } from "actor-core/inspector";
import type { ActorCoreApp } from "actor-core";

export class MemoryManagerDriver implements ManagerDriver {
	#state: MemoryGlobalState;

	/**
	 * @internal
	 */
	inspector: ManagerInspector = new ManagerInspector(this, {
		getAllActors: () => this.#state.getAllActors(),
		getAllTypesOfActors: () => Object.keys(this.app.config.actors),
	});

	constructor(
		private readonly app: ActorCoreApp<any>,
		state: MemoryGlobalState,
	) {
		this.#state = state;
	}

	async getForId({
		actorId,
	}: GetForIdInput): Promise<GetActorOutput | undefined> {
		// Validate the actor exists
		const actor = this.#state.getActor(actorId);
		if (!actor) {
			return undefined;
		}

		return {
			actorId: actor.id,
			name: actor.name,
			key: actor.key,
			meta: undefined,
		};
	}

	async getWithKey({
		name,
		key,
	}: GetWithKeyInput): Promise<GetActorOutput | undefined> {
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
				meta: undefined,
			};
		}

		return undefined;
	}

	async createActor({
		name,
		key,
	}: CreateActorInput): Promise<CreateActorOutput> {
		// Check if actor with the same name and key already exists
		const existingActor = await this.getWithKey({ name, key });
		if (existingActor) {
			throw new ActorAlreadyExists(name, key);
		}

		const actorId = crypto.randomUUID();
		this.#state.createActor(actorId, name, key);

		this.inspector.onActorsChange(this.#state.getAllActors());

		return { actorId, meta: undefined };
	}
}
