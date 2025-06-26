import * as crypto from "node:crypto";
import type {
	GetOrCreateWithKeyInput,
	GetForIdInput,
	GetWithKeyInput,
	ManagerDriver,
	ActorOutput,
	CreateInput,
} from "@/driver-helpers/mod";
import { ActorAlreadyExists } from "@/actor/errors";
import { logger } from "./log";
import type { FileSystemGlobalState } from "./global-state";
import { ActorState } from "./global-state";
import type { Registry } from "@/registry/mod";

export class FileSystemManagerDriver implements ManagerDriver {
	#state: FileSystemGlobalState;

	// inspector: ManagerInspector = new ManagerInspector(this, {
	// 	getAllActors: () => this.#state.getAllActors(),
	// 	getAllTypesOfActors: () => Object.keys(this.registry.config.actors),
	// });

	constructor(
		state: FileSystemGlobalState,
	) {
		this.#state = state;
	}

	async getForId({ actorId }: GetForIdInput): Promise<ActorOutput | undefined> {
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
			};
		} catch (error) {
			logger().error("failed to read actor state", { actorId, error });
			return undefined;
		}
	}

	async getWithKey({
		name,
		key,
	}: GetWithKeyInput): Promise<ActorOutput | undefined> {
		// Search through all actors to find a match
		const actor = this.#state.findActorByNameAndKey(name, key);

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
		// First try to get the actor without locking
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
		await this.#state.createActor(actorId, name, key, input);

		// Notify inspector about actor changes
		// this.inspector.onActorsChange(this.#state.getAllActors());

		return {
			actorId,
			name,
			key,
		};
	}
}
