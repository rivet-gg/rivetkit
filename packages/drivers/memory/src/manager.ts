import type {
	CreateActorInput,
	CreateActorOutput,
	GetActorOutput,
	GetForIdInput,
	GetWithTagsInput,
	ManagerDriver,
} from "actor-core/driver-helpers";
import type { MemoryGlobalState } from "./global_state";
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
		baseUrl,
		actorId,
	}: GetForIdInput): Promise<GetActorOutput | undefined> {
		// Validate the actor exists
		const actor = this.#state.getActor(actorId);
		if (!actor) {
			return undefined;
		}

		return {
			endpoint: buildActorEndpoint(baseUrl, actorId),
			name: actor.name,
			tags: actor.tags,
		};
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
		this.#state.createActor(actorId, name, tags);

		this.inspector.onActorsChange(this.#state.getAllActors());

		return {
			endpoint: buildActorEndpoint(baseUrl, actorId),
		};
	}
}

function buildActorEndpoint(baseUrl: string, actorId: string) {
	return `${baseUrl}/actors/${actorId}`;
}
