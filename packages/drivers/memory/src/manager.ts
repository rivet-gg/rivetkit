import type {
	CreateActorInput,
	CreateActorOutput,
	GetActorOutput,
	GetForIdInput,
	GetWithTagsInput,
	ManagerDriver,
} from "actor-core/driver-helpers";
import type { MemoryGlobalState } from "./global_state";

export class MemoryManagerDriver implements ManagerDriver {
	#state: MemoryGlobalState;

	constructor(state: MemoryGlobalState) {
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
			tags: actor.tags,
		};
	}

	async getWithTags({
		baseUrl,
		tags,
	}: GetWithTagsInput): Promise<GetActorOutput | undefined> {
		// TODO: Update tag search to use inverse tree
		const serializedSearchTags = JSON.stringify(tags);
		const actor = this.#state.findActor(
			(actor) => JSON.stringify(actor.tags) === serializedSearchTags,
		);

		if (actor) {
			return {
				endpoint: buildActorEndpoint(baseUrl, actor.id),
				tags: actor.tags,
			};
		}

		return undefined;
	}

	async createActor({
		baseUrl,
		region: _,
		tags,
	}: CreateActorInput): Promise<CreateActorOutput> {
		const actorId = crypto.randomUUID();
		this.#state.createActor(actorId, tags);
		return {
			endpoint: buildActorEndpoint(baseUrl, actorId),
		};
	}
}

function buildActorEndpoint(baseUrl: string, actorId: string) {
	return `${baseUrl}/actors/${actorId}`;
}
