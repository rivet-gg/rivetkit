import type {
	ManagerDriver,
	GetForIdInput,
	GetWithTagsInput,
	CreateActorInput,
	GetActorOutput,
} from "actor-core/driver-helpers";
import { Bindings } from "./mod";

export class CloudflareWorkersManagerDriver implements ManagerDriver {
	async getForId({
		c,
		baseUrl,
		actorId,
	}: GetForIdInput<{ Bindings: Bindings }>): Promise<
		GetActorOutput | undefined
	> {
		if (!c) throw new Error("Missing Hono context");

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
		const tagsStr = await c.env.ACTOR_KV.get(`actor:${actorId}:tags`);

		// If the actor doesn't exist, return undefined
		if (!tagsStr) {
			return undefined;
		}

		const tags = JSON.parse(tagsStr);

		return {
			endpoint: buildActorEndpoint(baseUrl, actorId),
			tags,
		};
	}

	async getWithTags({
		c,
		baseUrl,
		tags,
	}: GetWithTagsInput<{ Bindings: Bindings }>): Promise<
		GetActorOutput | undefined
	> {
		if (!c) throw new Error("Missing Hono context");

		// TODO: use an inverse tree for correct tag looups

		const actorId = await c.env.ACTOR_KV.get(
			`actor:tags:${JSON.stringify(tags)}:id`,
		);
		if (actorId) {
			// Get the complete tags for the actor
			const tagsStr = await c.env.ACTOR_KV.get(`actor:${actorId}:tags`);
			const actorTags = tagsStr ? JSON.parse(tagsStr) : tags;

			return {
				endpoint: buildActorEndpoint(baseUrl, actorId),
				tags: actorTags,
			};
		}
		return undefined;
	}

	async createActor({
		c,
		baseUrl,
		region,
		tags,
	}: CreateActorInput<{ Bindings: Bindings }>): Promise<GetActorOutput> {
		if (!c) throw new Error("Missing Hono context");

		const actorId = c.env.ACTOR_DO.newUniqueId({
			jurisdiction: region as DurableObjectJurisdiction | undefined,
		});

		// Init actor
		const actor = c.env.ACTOR_DO.get(actorId);
		await actor.initialize({
			tags,
		});

		// Save tags (after init so the actor is ready)
		await c.env.ACTOR_KV.put(
			`actor:tags:${JSON.stringify(tags)}:id`,
			actorId.toString(),
		);

		// Also store the tags indexed by actor ID
		await c.env.ACTOR_KV.put(`actor:${actorId}:tags`, JSON.stringify(tags));

		return {
			endpoint: buildActorEndpoint(baseUrl, actorId.toString()),
			tags,
		};
	}
}

function buildActorEndpoint(baseUrl: string, actorId: string) {
	return `${baseUrl}/actors/${actorId}`;
}
