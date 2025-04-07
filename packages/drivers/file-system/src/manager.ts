import * as crypto from "node:crypto";
import type {
	CreateActorInput,
	CreateActorOutput,
	GetActorOutput,
	GetForIdInput,
	GetWithTagsInput,
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
		baseUrl,
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
				endpoint: buildActorEndpoint(baseUrl, actorId),
				name: state.name,
				tags: state.tags,
			};
		} catch (error) {
			logger().error("failed to read actor state", { actorId, error });
			return undefined;
		}
	}

	async getWithTags({
		baseUrl,
		name,
		tags,
	}: GetWithTagsInput): Promise<GetActorOutput | undefined> {
		// NOTE: This is a slow implementation that checks each actor individually.
		// This can be optimized with an index in the future.

		// Search through all actors to find a match
		// Find actors with a superset of the queried tags
		const actor = this.#state.findActor((actor) => {
			if (actor.name !== name) return false;

			for (const key in tags) {
				const value = tags[key];

				// If actor doesn't have this tag key, or values don't match, it's not a match
				if (actor.tags[key] === undefined || actor.tags[key] !== value) {
					return false;
				}
			}
			return true;
		});

		if (actor) {
			return {
				endpoint: buildActorEndpoint(baseUrl, actor.id),
				name,
				tags: actor.tags,
			};
		}

		return undefined;
	}

	async createActor({
		baseUrl,
		name,
		tags,
	}: CreateActorInput): Promise<CreateActorOutput> {
		const actorId = crypto.randomUUID();
		await this.#state.createActor(actorId, name, tags);
		
		// Notify inspector about actor changes
		this.inspector.onActorsChange(this.#state.getAllActors());
		
		return {
			endpoint: buildActorEndpoint(baseUrl, actorId),
		};
	}
}

function buildActorEndpoint(baseUrl: string, actorId: string) {
	return `${baseUrl}/actors/${actorId}`;
}
