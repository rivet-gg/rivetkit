import type {
	CreateActorInput,
	GetActorOutput,
	GetForIdInput,
	GetWithTagsInput,
	ManagerDriver,
} from "actor-core/driver-helpers";
import type Redis from "ioredis";
import { KEYS } from "./keys";

export class RedisManagerDriver implements ManagerDriver {
	#redis: Redis;

	constructor(redis: Redis) {
		this.#redis = redis;
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

		// Get tags from Redis
		const tagsStr = await this.#redis.get(KEYS.ACTOR.tags(actorId));
		
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

		const actorId = await this.#redis.get(
			`actor_tags:${JSON.stringify(tags)}:id`,
		);
		if (actorId) {
			// Get the complete tags for the actor
			const tagsStr = await this.#redis.get(KEYS.ACTOR.tags(actorId));
			const actorTags = tagsStr ? JSON.parse(tagsStr) : tags;
			
			return {
				endpoint: buildActorEndpoint(origin, actorId),
				tags: actorTags,
			};
		}
		return undefined;

		//// TODO(RVT-4248): Don't return actors that aren't networkable yet
		//actors = actors.filter((a) => {
		//	// This should never be triggered. This assertion will leak if private actors exist if it's ever triggered.
		//	if ((a.tags as ActorTags).access !== "public") {
		//		throw new Error("unreachable: actor tags not public");
		//	}
		//
		//	for (const portName in a.network.ports) {
		//		const port = a.network.ports[portName];
		//		if (!port.hostname || !port.port) return false;
		//	}
		//	return true;
		//});
		//
		//if (actors.length === 0) {
		//	return undefined;
		//}
		//
		//// Make the chosen actor consistent
		//if (actors.length > 1) {
		//	actors.sort((a, b) => a.id.localeCompare(b.id));
		//}
		//
		//return actors[0];
	}

	async createActor({
		origin,
		region: _,
		tags,
	}: CreateActorInput): Promise<GetActorOutput> {
		const actorId = crypto.randomUUID();

		await this.#redis.mset({
			[KEYS.ACTOR.initialized(actorId)]: "1",
			[KEYS.ACTOR.tags(actorId)]: JSON.stringify(tags),
			[`actor_tags:${JSON.stringify(tags)}:id`]: actorId,
		});

		return {
			endpoint: buildActorEndpoint(origin, actorId.toString()),
			tags,
		};
	}
}

function buildActorEndpoint(origin: string, actorId: string) {
	return `${origin}/actors/${actorId}`;
}
