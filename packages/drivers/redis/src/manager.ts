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

	async getForId({
		baseUrl,
		actorId,
	}: GetForIdInput): Promise<GetActorOutput | undefined> {
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
		const [name, tagsStr] = await this.#redis.mget(
			KEYS.ACTOR.name(actorId),
			KEYS.ACTOR.tags(actorId),
		);

		// If the actor doesn't exist, return undefined
		if (!name || !tagsStr) {
			return undefined;
		}

		const tags = JSON.parse(tagsStr);

		return {
			endpoint: buildActorEndpoint(baseUrl, actorId),
			name,
			tags,
		};
	}

	async getWithTags({
		baseUrl,
		name,
		tags,
	}: GetWithTagsInput): Promise<GetActorOutput | undefined> {
		// TODO: use an inverse tree for correct tag looups

		const actorId = await this.#redis.get(
			`actor_tags:${name}:${JSON.stringify(tags)}:id`,
		);
		if (actorId) {
			// Get the complete tags for the actor
			const [name, tagsStr] = await this.#redis.mget(
				KEYS.ACTOR.name(actorId),
				KEYS.ACTOR.tags(actorId),
			);
			if (!name || !tagsStr) throw new Error("No actor found for ID");
			const actorTags = JSON.parse(tagsStr);

			return {
				endpoint: buildActorEndpoint(baseUrl, actorId),
				name,
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
		baseUrl,
		name,
		tags,
	}: CreateActorInput): Promise<GetActorOutput> {
		const actorId = crypto.randomUUID();

		await this.#redis.mset({
			[KEYS.ACTOR.initialized(actorId)]: "1",
			[KEYS.ACTOR.name(actorId)]: name,
			[KEYS.ACTOR.tags(actorId)]: JSON.stringify(tags),
			[`actor_tags:${JSON.stringify(tags)}:id`]: actorId,
		});

		return {
			endpoint: buildActorEndpoint(baseUrl, actorId.toString()),
			name,
			tags,
		};
	}
}

function buildActorEndpoint(baseUrl: string, actorId: string) {
	return `${baseUrl}/actors/${actorId}`;
}
