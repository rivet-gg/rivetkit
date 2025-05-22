import type {
	GetForIdInput,
	GetWithKeyInput,
	GetOrCreateWithKeyInput,
	ManagerDriver,
	CreateInput,
} from "@/driver-helpers/mod";
import { ActorAlreadyExists } from "@/actor/errors";
import type { TestGlobalState } from "./global-state";
import * as crypto from "node:crypto";
import { ManagerInspector } from "@/inspector/manager";
import type { ActorCoreApp } from "@/app/mod";
import { ActorOutput } from "@/manager/driver";

export class TestManagerDriver implements ManagerDriver {
	#state: TestGlobalState;

	/**
	 * @internal
	 */
	inspector: ManagerInspector = new ManagerInspector(this, {
		getAllActors: () => this.#state.getAllActors(),
		getAllTypesOfActors: () => Object.keys(this.app.config.actors),
	});

	constructor(
		private readonly app: ActorCoreApp<any>,
		state: TestGlobalState,
	) {
		this.#state = state;
	}

	async getForId({ actorId }: GetForIdInput): Promise<ActorOutput | undefined> {
		// Validate the actor exists
		const actor = this.#state.getActor(actorId);
		if (!actor) {
			return undefined;
		}

		return {
			actorId,
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

		const actor = this.#state.findActor((actor) => {
			if (actor.name !== name) {
				return false;
			}

			// handle empty key
			if (key === null || key === undefined) {
				return actor.key === null || actor.key === undefined;
			}

			// handle array
			if (Array.isArray(key)) {
				if (!Array.isArray(actor.key)) {
					return false;
				}
				if (key.length !== actor.key.length) {
					return false;
				}
				// Check if all elements in key are in actor.key
				for (let i = 0; i < key.length; i++) {
					if (key[i] !== actor.key[i]) {
						return false;
					}
				}
				return true;
			}

			// Handle object
			if (typeof key === "object" && !Array.isArray(key)) {
				if (typeof actor.key !== "object" || Array.isArray(actor.key)) {
					return false;
				}
				if (actor.key === null) {
					return false;
				}

				// Check if all keys in key are in actor.key
				const keyObj = key as Record<string, unknown>;
				const actorKeyObj = actor.key as unknown as Record<string, unknown>;
				for (const k in keyObj) {
					if (!(k in actorKeyObj) || keyObj[k] !== actorKeyObj[k]) {
						return false;
					}
				}
				return true;
			}

			// handle scalar
			return key === actor.key;
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

		this.inspector.onActorsChange(this.#state.getAllActors());

		return {
			actorId,
			name,
			key,
		};
	}
}
