import type {
	ManagerDriver,
	GetForIdInput,
	GetWithTagsInput,
	CreateActorInput,
	GetActorOutput,
} from "actor-core/driver-helpers";
import { ActorHandlerInterface } from "./actor_handler_do";

export class CloudflareWorkersManagerDriver implements ManagerDriver {
	#actorKvNs: KVNamespace;
	#actorDoNs: DurableObjectNamespace<ActorHandlerInterface>;

	constructor(
		actorKvNs: KVNamespace,
		actorDoNs: DurableObjectNamespace<ActorHandlerInterface>,
	) {
		this.#actorKvNs = actorKvNs;
		this.#actorDoNs = actorDoNs;
	}

	async getForId({ origin, actorId }: GetForIdInput): Promise<GetActorOutput | undefined> {
		// TODO: Error handling

		//// Validate actor
		//if ((res.actor.tags as ActorTags).access !== "public") {
		//	// TODO: Throw 404 that matches the 404 from Fern if the actor is not found
		//	throw new Error(`Actor with ID ${query.getForId.actorId} is private`);
		//}
		//if (res.actor.destroyedAt) {
		//	throw new Error(
		//		`Actor with ID ${query.getForId.actorId} already destroyed`,
		//	);
		//}
		//
		//return res.actor;

		// Get tags from KV
		const tagsStr = await this.#actorKvNs.get(`actor:${actorId}:tags`);
		
		// If the actor doesn't exist, return undefined
		if (!tagsStr) {
			return undefined;
		}
		
		const tags = JSON.parse(tagsStr);

		return {
			endpoint: buildActorEndpoint(origin, actorId),
			tags,
		};
	}

	async getWithTags({
		origin,
		tags,
	}: GetWithTagsInput): Promise<GetActorOutput | undefined> {
		// TODO: use an inverse tree for correct tag looups

		const actorId = await this.#actorKvNs.get(
			`actor:tags:${JSON.stringify(tags)}:id`,
		);
		if (actorId) {
			// Get the complete tags for the actor
			const tagsStr = await this.#actorKvNs.get(`actor:${actorId}:tags`);
			const actorTags = tagsStr ? JSON.parse(tagsStr) : tags;
			
			return {
				endpoint: buildActorEndpoint(origin, actorId),
				tags: actorTags,
			};
		}
		return undefined;
	}

	async createActor({
		origin,
		region,
		tags,
	}: CreateActorInput): Promise<GetActorOutput> {
		const actorId = this.#actorDoNs.newUniqueId({
			jurisdiction: region as DurableObjectJurisdiction | undefined,
		});

		// Init actor
		const actor = this.#actorDoNs.get(actorId);
		await actor.initialize({
			tags,
		});

		// Save tags (after init so the actor is ready)
		await this.#actorKvNs.put(
			`actor:tags:${JSON.stringify(tags)}:id`,
			actorId.toString(),
		);
		
		// Also store the tags indexed by actor ID
		await this.#actorKvNs.put(
			`actor:${actorId}:tags`,
			JSON.stringify(tags),
		);

		return {
			endpoint: buildActorEndpoint(origin, actorId.toString()),
			tags,
		};
	}
}

function buildActorEndpoint(origin: string, actorId: string) {
	return `${origin}/actors/${actorId}`;
}
