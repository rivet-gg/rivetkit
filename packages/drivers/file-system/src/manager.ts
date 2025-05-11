import * as crypto from "node:crypto";
import type {
	CreateActorInput,
	CreateActorOutput,
	GetActorOutput,
	GetForIdInput,
	GetWithKeyInput,
	ManagerDriver,
} from "actor-core/driver-helpers";
import { logger } from "./log";
import type { FileSystemGlobalState } from "./global_state";
import type { ActorCoreApp } from "actor-core";
import { ManagerInspector } from "actor-core/inspector";

export class FileSystemManagerDriver implements ManagerDriver {
	#state: FileSystemGlobalState;

	/**
	 * @internal
	 */
	inspector: ManagerInspector = new ManagerInspector(this, {
		getAllActors: () => this.#state.getAllActors(),
		getAllTypesOfActors: () => Object.keys(this.app.config.actors),
	});

	constructor(
		private readonly app: ActorCoreApp<any>,
		state: FileSystemGlobalState,
	) {
		this.#state = state;
	}

	async getForId({
		actorId,
	}: GetForIdInput): Promise<GetActorOutput | undefined> {
		// Validate the actor exists
		if (!this.#state.hasActor(actorId)) {
			return undefined;
		}

		try {
			// Load actor state
			const state = this.#state.loadActorState(actorId);

			return {
				actorId,
				name: state.name,
				key: state.key,
				meta: undefined,
			};
		} catch (error) {
			logger().error("failed to read actor state", { actorId, error });
			return undefined;
		}
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
		const actorId = crypto.randomUUID();
		await this.#state.createActor(actorId, name, key);

		// Notify inspector about actor changes
		this.inspector.onActorsChange(this.#state.getAllActors());

		return {
			actorId,
			meta: undefined,
		};
	}
}
