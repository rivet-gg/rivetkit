import type {
	CreateActorInput,
	CreateActorOutput,
	GetActorOutput,
	GetForIdInput,
	GetWithTagsInput,
	ManagerDriver,
} from "actor-core/driver-helpers";
import type Redis from "ioredis";
import { KEYS } from "./keys";
import { ManagerInspector } from "actor-core/inspector";
import type { ActorCoreApp } from "actor-core";

interface Actor {
	id: string;
	name: string;
	tags: Record<string, string>;
	region?: string;
	createdAt?: string;
	destroyedAt?: string;
}

/**
 * Redis Manager Driver for Actor-Core
 * Implements efficient tag-based indexing using Redis Sets
 */
export class RedisManagerDriver implements ManagerDriver {
	#redis: Redis;
	#app?: ActorCoreApp<any>;

	/**
	 * @internal
	 */
	inspector: ManagerInspector = new ManagerInspector(this, {
		getAllActors: () => {
			// Create a function that returns an array of actors directly
			// Not returning a Promise since the ManagerInspector expects a synchronous function
			const actors: Actor[] = [];

			// Return empty array since we can't do async operations here
			// The actual data will be fetched when needed by calling getAllActors() manually
			return actors;
		},
		getAllTypesOfActors: () => {
			if (!this.#app) return [];
			return Object.keys(this.#app.config.actors);
		},
	});

	constructor(redis: Redis, app?: ActorCoreApp<any>) {
		this.#redis = redis;
		this.#app = app;
	}

	async getForId({
		baseUrl,
		actorId,
	}: GetForIdInput): Promise<GetActorOutput | undefined> {
		// Get metadata from Redis
		const metadataStr = await this.#redis.get(KEYS.ACTOR.metadata(actorId));

		// If the actor doesn't exist, return undefined
		if (!metadataStr) {
			return undefined;
		}

		const metadata = JSON.parse(metadataStr);
		const { name, tags } = metadata;

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
		if (Object.keys(tags).length === 0) {
			// Handle the case of no tags - try to find any actor with this name
			// This gets the first matching actor by name
			const actorIds = await this.#redis.smembers(this.#getNameIndexKey(name));

			if (actorIds.length > 0) {
				// Use the first actor (should be consistent for the same query)
				const actorId = actorIds[0];
				return this.#buildActorOutput(baseUrl, actorId);
			}

			return undefined;
		}

		// For tag queries, we need to find actors with at least these tags
		// 1. Get all actors with the requested name
		// 2. Find actors that have all the requested tags
		const nameKey = this.#getNameIndexKey(name);

		// Get the set of actor IDs for each tag
		const tagKeys: string[] = [];
		for (const [key, value] of Object.entries(tags)) {
			tagKeys.push(this.#getTagIndexKey(name, key, value));
		}

		// If we have tags to search for, add the name index as the first key
		// This ensures we only match actors with the correct name
		tagKeys.unshift(nameKey);

		// Use SINTER to find actors with all requested tags
		// This efficiently finds the intersection of all sets
		const matchingActorIds = await this.#redis.sinter(tagKeys);

		if (matchingActorIds.length > 0) {
			// Use the first actor (should be consistent for the same query)
			const actorId = matchingActorIds[0];
			return this.#buildActorOutput(baseUrl, actorId);
		}

		return undefined;
	}

	async createActor({
		baseUrl,
		name,
		tags,
	}: CreateActorInput): Promise<CreateActorOutput> {
		const actorId = crypto.randomUUID();

		// Use a transaction to ensure all operations are atomic
		const pipeline = this.#redis.multi();

		// Store basic actor information
		pipeline.set(KEYS.ACTOR.initialized(actorId), "1");
		pipeline.set(KEYS.ACTOR.metadata(actorId), JSON.stringify({ name, tags }));

		// Add to name index
		pipeline.sadd(this.#getNameIndexKey(name), actorId);

		// Add to tag indexes for each tag
		for (const [key, value] of Object.entries(tags)) {
			pipeline.sadd(this.#getTagIndexKey(name, key, value), actorId);
		}

		// Execute all commands atomically
		await pipeline.exec();

		// Notify inspector of actor creation with minimal data
		// to avoid async Redis calls after cleanup
		this.inspector.onActorsChange([
			{
				id: actorId,
				name,
				tags,
			},
		]);

		return {
			endpoint: buildActorEndpoint(baseUrl, actorId.toString()),
		};
	}

	// Helper method to get all actors (for inspector)
	private async getAllActors(): Promise<Actor[]> {
		const keys = await this.#redis.keys(
			KEYS.ACTOR.metadata("*").replace(/:metadata$/, ""),
		);
		const actorIds = keys.map((key) => key.split(":")[1]);

		const actors: Actor[] = [];
		for (const actorId of actorIds) {
			const metadataStr = await this.#redis.get(KEYS.ACTOR.metadata(actorId));

			if (metadataStr) {
				const metadata = JSON.parse(metadataStr);
				actors.push({
					id: actorId,
					name: metadata.name,
					tags: metadata.tags,
				});
			}
		}

		return actors;
	}

	// Helper method to build actor output from an ID
	async #buildActorOutput(
		baseUrl: string,
		actorId: string,
	): Promise<GetActorOutput | undefined> {
		const metadataStr = await this.#redis.get(KEYS.ACTOR.metadata(actorId));

		if (!metadataStr) {
			return undefined;
		}

		const metadata = JSON.parse(metadataStr);
		const { name, tags } = metadata;

		return {
			endpoint: buildActorEndpoint(baseUrl, actorId),
			name,
			tags,
		};
	}

	// Helper methods for consistent key naming
	#getNameIndexKey(name: string): string {
		return `actor_name:${name}`;
	}

	#getTagIndexKey(name: string, tagKey: string, tagValue: string): string {
		return `actor_tag:${name}:${tagKey}:${tagValue}`;
	}
}

function buildActorEndpoint(baseUrl: string, actorId: string) {
	return `${baseUrl}/actors/${actorId}`;
}

