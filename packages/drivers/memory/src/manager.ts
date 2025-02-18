import type {
	CreateActorInput,
	CreateActorOutput,
	GetActorOutput,
	GetForIdInput,
	GetWithTagsInput,
	ManagerDriver,
} from "actor-core/driver-helpers";
import { GlobalState } from "./global_state";

export class MemoryManagerDriver implements ManagerDriver {
	#state: GlobalState;

	constructor() {
		this.#state = GlobalState.getInstance();
	}

	async getForId({
		origin,
		actorId,
	}: GetForIdInput): Promise<GetActorOutput | undefined> {
		// Validate the actor exists
		const actor = this.#state.getActor(actorId);
		if (!actor) {
			return undefined;
		}

		return {
			endpoint: buildActorEndpoint(origin, actorId),
			tags: actor.tags,
		};
	}

	async getWithTags({
		origin,
		tags,
	}: GetWithTagsInput): Promise<GetActorOutput | undefined> {
		// TODO: Update tag search to use inverse tree
		const serializedSearchTags = JSON.stringify(tags);
		const actor = this.#state.findActor(
			(actor) => JSON.stringify(actor.tags) === serializedSearchTags,
		);

		if (actor) {
			return {
				endpoint: buildActorEndpoint(origin, actor.id),
				tags: actor.tags,
			};
		}

		return undefined;
	}

	async createActor({
		origin,
		region: _,
		tags,
	}: CreateActorInput): Promise<CreateActorOutput> {
		const actorId = crypto.randomUUID();
		this.#state.createActor(actorId, tags);
		return {
			endpoint: buildActorEndpoint(origin, actorId),
		};
	}
}

function buildActorEndpoint(origin: string, actorId: string) {
	return `${origin}/actors/${actorId}`;
}
