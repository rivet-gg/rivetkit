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
import { ManagerInspector } from "@/inspector/manager";
import type { ActorId } from "@/inspector/mod";

export class MemoryManagerDriver implements ManagerDriver {
	#state: MemoryGlobalState;

	inspector = new ManagerInspector(() => {
		const startedAt = new Date().toISOString();
		return {
			getAllActors: async ({ cursor, limit }) => {
				const actors = this.#state
					.getAllActors()
					.sort((a, b) => a.id.localeCompare(b.id));
				if (cursor) {
					const cursorIndex = actors.findIndex((actor) => actor.id === cursor);
					if (cursorIndex !== -1) {
						actors.splice(0, cursorIndex + 1);
					}
				}
				if (limit) {
					actors.splice(limit);
				}
				return actors.map((actor) => ({
					id: actor.id as ActorId,
					name: actor.name,
					key: actor.key,
					startedAt,
					createdAt: actor.createdAt?.toISOString() || new Date().toISOString(),
				}));
			},
			getActorById: async (id) => {
				const actor = this.#state.getActor(id);
				if (!actor) {
					return null;
				}
				return {
					id: actor.id as ActorId,
					name: actor.name,
					key: actor.key,
					startedAt,
					createdAt: actor.createdAt?.toISOString() || new Date().toISOString(),
				};
			},
		};
	});

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

		return { actorId, name, key };
	}
}
