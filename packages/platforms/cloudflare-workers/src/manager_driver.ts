import type {
	ManagerDriver,
	GetForIdInput,
	GetWithTagsInput,
	CreateActorInput,
	GetActorOutput,
} from "actor-core/driver-helpers";
import { Bindings } from "./mod";
import { logger } from "./log";

// Define metadata type for CloudflareKV
interface KVMetadata {
	actorId: string;
}

// Actor metadata structure
interface ActorData {
	name: string;
	tags: Record<string, string>;
}

/**
 * Safely encodes strings used as parts of KV keys using URI encoding
 */
function safeSerialize(value: string): string {
	return encodeURIComponent(value);
}

// Key constants similar to Redis implementation
const KEYS = {
	ACTOR: {
		// Combined key for actor metadata (name and tags)
		metadata: (actorId: string) => `actor:${actorId}:metadata`,
	},
	INDEX: {
		name: (name: string) => `actor_name:${safeSerialize(name)}:`,
		tag: (name: string, tagKey: string, tagValue: string) =>
			`actor_tag:${safeSerialize(name)}:${safeSerialize(tagKey)}:${safeSerialize(tagValue)}:`,
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

		// Get actor metadata from KV (combined name and tags)
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
			tags: actorData.tags,
		};
	}

	async getWithTags({
		c,
		baseUrl,
		name,
		tags,
	}: GetWithTagsInput<{ Bindings: Bindings }>): Promise<
		GetActorOutput | undefined
	> {
		if (!c) throw new Error("Missing Hono context");
		const log = logger();

		log.debug("getWithTags: searching for actor", { name, tags });

		// If no tags specified, just get the first actor with the name
		if (Object.keys(tags).length === 0) {
			const namePrefix = `${KEYS.INDEX.name(name)}`;
			const { keys: actorKeys } = await c.env.ACTOR_KV.list({
				prefix: namePrefix,
				limit: 1,
			});

			if (actorKeys.length === 0) {
				log.debug("getWithTags: no actors found with name", { name });
				return undefined;
			}

			// Extract actor ID from the key name
			const key = actorKeys[0].name;
			const actorId = key.substring(namePrefix.length);

			log.debug("getWithTags: no tags specified, returning first actor", {
				actorId,
			});
			return this.#buildActorOutput(c, baseUrl, actorId);
		}

		// For tagged queries, use the tag indexes
		// We'll find actors that match each tag individually, then intersect the results
		let matchedActorIds: string[] | null = null;

		for (const [tagKey, tagValue] of Object.entries(tags)) {
			// Use tag index to find matching actors
			const tagPrefix = `${KEYS.INDEX.tag(name, tagKey, tagValue)}`;
			const { keys: taggedActorKeys } = await c.env.ACTOR_KV.list({
				prefix: tagPrefix,
			});

			// Extract actor IDs from the keys
			const actorIdsWithTag = taggedActorKeys.map((key) =>
				key.name.substring(tagPrefix.length),
			);

			log.debug(`getWithTags: found actors with tag ${tagKey}=${tagValue}`, {
				count: actorIdsWithTag.length,
			});

			// If no actors have this tag, we can short-circuit
			if (actorIdsWithTag.length === 0) {
				log.debug("getWithTags: no actors found with required tag", {
					tagKey,
					tagValue,
				});
				return undefined;
			}

			// Initialize or intersect with current set
			if (matchedActorIds === null) {
				matchedActorIds = actorIdsWithTag;
			} else {
				// Create the intersection of the two arrays
				// This is equivalent to Set.intersection if it existed
				matchedActorIds = matchedActorIds.filter((id) =>
					actorIdsWithTag.includes(id),
				);

				// If intersection is empty, no actor matches all tags
				if (matchedActorIds.length === 0) {
					log.debug("getWithTags: no actors found with all required tags");
					return undefined;
				}
			}
		}

		// If we found actors matching all tags, return the first one
		if (matchedActorIds && matchedActorIds.length > 0) {
			const actorId = matchedActorIds[0];
			log.debug("getWithTags: found actor with matching tags", {
				actorId,
				name,
				tags,
			});
			return this.#buildActorOutput(c, baseUrl, actorId);
		}

		log.debug("getWithTags: no actor found with matching tags");
		return undefined;
	}

	async createActor({
		c,
		baseUrl,
		name,
		tags,
		region,
	}: CreateActorInput<{ Bindings: Bindings }>): Promise<GetActorOutput> {
		if (!c) throw new Error("Missing Hono context");
		const log = logger();

		const durableId = c.env.ACTOR_DO.newUniqueId({
			jurisdiction: region as DurableObjectJurisdiction | undefined,
		});
		const actorId = durableId.toString();

		// Init actor
		const actor = c.env.ACTOR_DO.get(durableId);
		await actor.initialize({
			name,
			tags,
		});

		// Store combined actor metadata (name and tags)
		const actorData: ActorData = { name, tags };
		await c.env.ACTOR_KV.put(
			KEYS.ACTOR.metadata(actorId),
			JSON.stringify(actorData),
		);

		// Add to name index with metadata
		const metadata: KVMetadata = { actorId };
		await c.env.ACTOR_KV.put(`${KEYS.INDEX.name(name)}${actorId}`, "1", {
			metadata,
		});

		// Add to tag indexes for each tag
		for (const [tagKey, tagValue] of Object.entries(tags)) {
			await c.env.ACTOR_KV.put(
				`${KEYS.INDEX.tag(name, tagKey, tagValue)}${actorId}`,
				"1",
				{ metadata },
			);
		}

		return {
			endpoint: buildActorEndpoint(baseUrl, actorId),
			name,
			tags,
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
			tags: actorData.tags,
		};
	}
}

function buildActorEndpoint(baseUrl: string, actorId: string) {
	return `${baseUrl}/actors/${actorId}`;
}

