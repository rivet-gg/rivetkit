import type {
	CreateActorInput,
	CreateActorOutput,
	GetActorOutput,
	GetForIdInput,
	GetWithTagsInput,
	ManagerDriver,
} from "@/driver-helpers/mod";
import type { TestGlobalState } from "./global_state";

export class TestManagerDriver implements ManagerDriver {
	#state: TestGlobalState;

	constructor(state: TestGlobalState) {
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
		// TODO: Update tag search to use inverse tree
		const serializedSearchTags = JSON.stringify(tags);
		const actor = this.#state.findActor(
			(actor) =>
				actor.name === name &&
				JSON.stringify(actor.tags) === serializedSearchTags,
		);

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
		return {
			endpoint: buildActorEndpoint(baseUrl, actorId),
		};
	}
}

function buildActorEndpoint(baseUrl: string, actorId: string) {
	return `${baseUrl}/actors/${actorId}`;
}
