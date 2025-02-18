import type { ActorTags } from "actor-core";
import { assertUnreachable, ManagerDriver } from "actor-core/platform";
import type { ActorsResponse, CreateRequest } from "actor-core/manager/protocol";
import { logger } from "./log";
import { KEYS } from "@/redis";
import Redis from "ioredis";

export interface ActorState {
	tags: ActorTags;
	destroyedAt?: number;
}

function buildActorEndpoint(origin: string, actorId: string) {
	return `${origin}/actors/${actorId}`;
}

export function buildManager(redis: Redis): ManagerDriver {
	return {
		async queryActor({ body: { query }, request }) {
			const url = new URL(request.url);
			const origin = url.origin;

			logger().debug("query", { query, origin });
			if ("getForId" in query) {
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

				return { 
					endpoint: buildActorEndpoint(origin, query.getForId.actorId),
					supportedTransports: ["websocket", "sse"]
				};
			}
			if ("getOrCreateForTags" in query) {
				const tags = query.getOrCreateForTags.tags;
				if (!tags) throw new Error("Must define tags in getOrCreateForTags");

				const existingActor = await getWithTags(
					redis,
					origin,
					tags as ActorTags,
				);
				if (existingActor) {
					// Actor exists
					return existingActor;
				}

				if (query.getOrCreateForTags.create) {
					// Create if needed
					return await createActor(
						redis,
						origin,
						query.getOrCreateForTags.create,
					);
				}
				// Creation disabled
				throw new Error("Actor not found with tags or is private.");
			}
			if ("create" in query) {
				return await createActor(redis, origin, query.create);
			}
			assertUnreachable(query);
		},
	};
}

async function getWithTags(
	redis: Redis,
	origin: string,
	tags: ActorTags,
): Promise<ActorsResponse | undefined> {
	// TODO: use an inverse tree for correct tag looups

	const actorId = await redis.get(`actor_tags:${JSON.stringify(tags)}:id`);
	if (actorId) {
		return { 
			endpoint: buildActorEndpoint(origin, actorId),
			supportedTransports: ["websocket", "sse"]
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

async function createActor(
	redis: Redis,
	origin: string,
	createRequest: CreateRequest,
): Promise<ActorsResponse> {
	logger().info("creating actor", { ...createRequest });

	const actorId = crypto.randomUUID();

	await redis.mset({
		[KEYS.ACTOR.initialized(actorId)]: "1",
		[KEYS.ACTOR.tags(actorId)]: JSON.stringify(createRequest.tags),
		[`actor_tags:${JSON.stringify(createRequest.tags)}:id`]: actorId,
	});

	return { 
		endpoint: buildActorEndpoint(origin, actorId.toString()),
		supportedTransports: ["websocket", "sse"]
	};
}
