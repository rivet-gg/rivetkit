import type {
	CreateActorInput,
	CreateActorOutput,
	GetActorOutput,
	GetForIdInput,
	GetWithKeyInput,
	ManagerDriver,
} from "actor-core/driver-helpers";
import type Redis from "ioredis";
import { KEYS } from "./keys";
import { ManagerInspector } from "actor-core/inspector";
import type { ActorCoreApp } from "actor-core";

interface Actor {
	id: string;
	name: string;
	key: string[];
	region?: string;
	createdAt?: string;
	destroyedAt?: string;
}

/**
 * Redis Manager Driver for Actor-Core
 * Handles actor creation and lookup by ID or key
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
		actorId,
	}: GetForIdInput): Promise<GetActorOutput | undefined> {
		// Get metadata from Redis
		const metadataStr = await this.#redis.get(KEYS.ACTOR.metadata(actorId));

		// If the actor doesn't exist, return undefined
		if (!metadataStr) {
			return undefined;
		}

		const metadata = JSON.parse(metadataStr);
		const { name, key } = metadata;

		return {
			actorId,
			name,
			key,
			meta: undefined,
		};
	}

	async getWithKey({
		name,
		key,
	}: GetWithKeyInput): Promise<GetActorOutput | undefined> {
		// Since keys are 1:1 with actor IDs, we can directly look up by key
		const lookupKey = this.#generateActorKeyRedisKey(name, key);
		const actorId = await this.#redis.get(lookupKey);

		if (!actorId) {
			return undefined;
		}

		return this.getForId({ actorId });
	}

	async createActor({
		name,
		key,
	}: CreateActorInput): Promise<CreateActorOutput> {
		const actorId = crypto.randomUUID();
		const actorKeyRedisKey = this.#generateActorKeyRedisKey(name, key);

		// Use a transaction to ensure all operations are atomic
		const pipeline = this.#redis.multi();

		// Store basic actor information
		pipeline.set(KEYS.ACTOR.initialized(actorId), "1");
		pipeline.set(KEYS.ACTOR.metadata(actorId), JSON.stringify({ name, key }));

		// Create direct lookup by name+key -> actorId
		pipeline.set(actorKeyRedisKey, actorId);

		// Execute all commands atomically
		await pipeline.exec();

		// Notify inspector of actor creation
		this.inspector.onActorsChange([
			{
				id: actorId,
				name,
				key,
			},
		]);

		return {
			actorId,
			meta: undefined,
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
					key: metadata.key || [],
				});
			}
		}

		return actors;
	}

	// Generate a Redis key for looking up an actor by name+key
	#generateActorKeyRedisKey(name: string, key: string[]): string {
		// Base prefix for actor key lookups
		let redisKey = `actor_by_key:${this.#escapeRedisKey(name)}`;

		// Add each key component with proper escaping
		if (key.length > 0) {
			redisKey += `:${key.map((k) => this.#escapeRedisKey(k)).join(":")}`;
		}

		return redisKey;
	}

	// Escape special characters in Redis keys
	// Redis keys shouldn't contain spaces or control characters
	// and we need to escape the delimiter character (:)
	#escapeRedisKey(part: string): string {
		return part
			.replace(/\\/g, "\\\\") // Escape backslashes first
			.replace(/:/g, "\\:"); // Escape colons (our delimiter)
	}
}