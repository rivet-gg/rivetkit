import type {
	ManagerDriver,
	GetForIdInput,
	GetWithKeyInput,
	CreateActorInput,
	GetActorOutput,
} from "actor-core/driver-helpers";
import { Bindings } from "./mod";
import { logger } from "./log";
import { serializeNameAndKey, serializeKey } from "./util";

// Define metadata type for CloudflareKV
interface KVMetadata {
	actorId: string;
}

// Actor metadata structure
interface ActorData {
	name: string;
	key: string[];
}

// Key constants similar to Redis implementation
const KEYS = {
	ACTOR: {
		// Combined key for actor metadata (name and key)
		metadata: (actorId: string) => `actor:${actorId}:metadata`,

		// Key index function for actor lookup
		keyIndex: (name: string, key: string[] = []) => {
			// Use serializeKey for consistent handling of all keys
			return `actor_key:${serializeKey(key)}`;
		},
	},
};

export class CloudflareWorkersManagerDriver implements ManagerDriver {
	async getForId({
		c,
		baseUrl,
		actorId,
	}: GetForIdInput<{ Bindings: Bindings }>): Promise<
		GetActorOutput | undefined
	> {
		if (!c) throw new Error("Missing Hono context");

		// Get actor metadata from KV (combined name and key)
		const actorData = (await c.env.ACTOR_KV.get(KEYS.ACTOR.metadata(actorId), {
			type: "json",
		})) as ActorData | null;

		// If the actor doesn't exist, return undefined
		if (!actorData) {
			return undefined;
		}

		return {
			endpoint: buildActorEndpoint(baseUrl, actorId),
			name: actorData.name,
			key: actorData.key,
		};
	}

	async getWithKey({
		c,
		baseUrl,
		name,
		key,
	}: GetWithKeyInput<{ Bindings: Bindings }>): Promise<
		GetActorOutput | undefined
	> {
		if (!c) throw new Error("Missing Hono context");
		const log = logger();

		log.debug("getWithKey: searching for actor", { name, key });

		// Generate deterministic ID from the name and key
		// This is aligned with how createActor generates IDs
		const nameKeyString = serializeNameAndKey(name, key);
		const durableId = c.env.ACTOR_DO.idFromName(nameKeyString);
		const actorId = durableId.toString();

		// Check if the actor metadata exists
		const actorData = await c.env.ACTOR_KV.get(KEYS.ACTOR.metadata(actorId), {
			type: "json",
		});

		if (!actorData) {
			log.debug("getWithKey: no actor found with matching name and key", {
				name,
				key,
				actorId,
			});
			return undefined;
		}

		log.debug("getWithKey: found actor with matching name and key", {
			actorId,
			name,
			key,
		});
		return this.#buildActorOutput(c, baseUrl, actorId);
	}

	async createActor({
		c,
		baseUrl,
		name,
		key,
		region,
	}: CreateActorInput<{ Bindings: Bindings }>): Promise<GetActorOutput> {
		if (!c) throw new Error("Missing Hono context");
		const log = logger();

		// Create a deterministic ID from the actor name and key
		// This ensures that actors with the same name and key will have the same ID
		const nameKeyString = serializeNameAndKey(name, key);
		const durableId = c.env.ACTOR_DO.idFromName(nameKeyString);
		const actorId = durableId.toString();

		// Init actor
		const actor = c.env.ACTOR_DO.get(durableId);
		await actor.initialize({
			name,
			key,
		});

		// Store combined actor metadata (name and key)
		const actorData: ActorData = { name, key };
		await c.env.ACTOR_KV.put(
			KEYS.ACTOR.metadata(actorId),
			JSON.stringify(actorData),
		);

		// Add to key index for lookups by name and key
		await c.env.ACTOR_KV.put(KEYS.ACTOR.keyIndex(name, key), actorId);

		return {
			endpoint: buildActorEndpoint(baseUrl, actorId),
			name,
			key,
		};
	}

	// Helper method to build actor output from an ID
	async #buildActorOutput(
		c: any,
		baseUrl: string,
		actorId: string,
	): Promise<GetActorOutput | undefined> {
		const actorData = (await c.env.ACTOR_KV.get(KEYS.ACTOR.metadata(actorId), {
			type: "json",
		})) as ActorData | null;

		if (!actorData) {
			return undefined;
		}

		return {
			endpoint: buildActorEndpoint(baseUrl, actorId),
			name: actorData.name,
			key: actorData.key,
		};
	}
}

function buildActorEndpoint(baseUrl: string, actorId: string) {
	return `${baseUrl}/actors/${actorId}`;
}
