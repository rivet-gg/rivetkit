import { assertUnreachable } from "@/utils";
import { RivetActor, RivetClientConfig, rivetRequest } from "./rivet-client";
import { deserializeKeyFromTag, convertKeyToRivetTags } from "./util";
import invariant from "invariant";

interface ActorMeta {
	name: string;
	key: string[];
	endpoint: string;
}

interface ActorMetaWithId extends ActorMeta {
	actorId: string;
}

// TODO: Implement LRU cache
// Cache for actor ID -> actor meta
const ACTOR_META_CACHE = new Map<string, Promise<ActorMeta | undefined>>();

// TODO: Implement LRU cache
// Cache for actor name+key -> actor ID
const ACTOR_KEY_CACHE = new Map<string, Promise<string | undefined>>();

/**
 * Creates a cache key for actor name and key combination.
 */
function createKeysCacheKey(name: string, key: string[]): string {
	return `${name}:${JSON.stringify(key)}`;
}

/**
 * Returns actor metadata with an in-memory cache.
 */
export async function getActorMeta(
	clientConfig: RivetClientConfig,
	actorId: string,
): Promise<ActorMeta | undefined> {
	// TODO: This does not refresh cache when actors are destroyed. This
	// will be replaced with hot pulls from the Rivet API once (a) actor
	// IDs include the datacenter in order to build endpoints without
	// hitting the API and (b) we update the API to hit the regional
	// endpoints.

	const actorMetaPromise = ACTOR_META_CACHE.get(actorId);
	if (actorMetaPromise) {
		return await actorMetaPromise;
	} else {
		// Fetch meta
		const promise = (async () => {
			const { actor } = await rivetRequest<void, { actor: RivetActor }>(
				clientConfig,
				"GET",
				`/actors/${encodeURIComponent(actorId)}`,
			);

			return convertActorToMeta(actor);
		})();
		ACTOR_META_CACHE.set(actorId, promise);

		// Remove from cache on failure so it can be retried
		promise.catch(() => {
			ACTOR_META_CACHE.delete(actorId);
		});

		return await promise;
	}
}

/**
 * Returns actor metadata for a actor with the given name and key.
 */
export async function getActorMetaWithKey(
	clientConfig: RivetClientConfig,
	name: string,
	key: string[],
): Promise<ActorMetaWithId | undefined> {
	const cacheKey = createKeysCacheKey(name, key);

	// Check if we have the actor ID cached
	const cachedActorIdPromise = ACTOR_KEY_CACHE.get(cacheKey);
	if (cachedActorIdPromise) {
		const actorId = await cachedActorIdPromise;
		if (actorId) {
			// Try to get the actor metadata from the ID cache
			const meta = await getActorMeta(clientConfig, actorId);
			if (meta) {
				return {
					...meta,
					actorId,
				};
			}
			// If metadata is not available, remove from key cache and continue with fresh lookup
			ACTOR_KEY_CACHE.delete(cacheKey);
		}
	}

	// Cache miss or invalid cached data, perform fresh lookup
	const promise = (async () => {
		// Convert key array to Rivet's tag format
		const rivetTags = convertKeyToRivetTags(name, key);

		// Query actors with matching tags
		const { actors } = await rivetRequest<void, { actors: RivetActor[] }>(
			clientConfig,
			"GET",
			`/actors?tags_json=${encodeURIComponent(JSON.stringify(rivetTags))}`,
		);

		// Filter actors to ensure they're valid
		const validActors = actors.filter((a: RivetActor) => {
			// Verify all ports have hostname and port
			for (const portName in a.network.ports) {
				const port = a.network.ports[portName];
				if (!port.hostname || !port.port) return false;
			}
			return true;
		});

		if (validActors.length === 0) {
			// Remove from cache if not found since we might create an actor
			// with this key
			ACTOR_KEY_CACHE.delete(cacheKey);

			return undefined;
		}

		// For consistent results, sort by ID if multiple actors match
		const actor =
			validActors.length > 1
				? validActors.sort((a, b) => a.id.localeCompare(b.id))[0]
				: validActors[0];

		// Populate both caches
		const meta = populateCache(actor);
		invariant(meta, "actor should not be destroyed");

		return actor.id;
	})();

	ACTOR_KEY_CACHE.set(cacheKey, promise);

	// Remove from cache on failure so it can be retried
	promise.catch(() => {
		ACTOR_KEY_CACHE.delete(cacheKey);
	});

	const actorId = await promise;
	if (!actorId) {
		return undefined;
	}

	const meta = await getActorMeta(clientConfig, actorId);
	invariant(meta, "actor metadata should be available after populating cache");

	return {
		...meta,
		actorId,
	};
}

/**
 * Preemptively adds an entry to the cache.
 */
export function populateCache(actor: RivetActor): ActorMeta | undefined {
	const meta = convertActorToMeta(actor);
	if (meta) {
		// Populate the actor ID -> metadata cache
		ACTOR_META_CACHE.set(actor.id, Promise.resolve(meta));

		// Populate the name+key -> actor ID cache
		const cacheKey = createKeysCacheKey(meta.name, meta.key);
		ACTOR_KEY_CACHE.set(cacheKey, Promise.resolve(actor.id));
	}
	return meta;
}

/**
 * Converts actor data from the Rivet API to actor metadata.
 */
function convertActorToMeta(actor: RivetActor): ActorMeta | undefined {
	// Check if actor exists and not destroyed
	if (actor.destroyedAt) {
		return undefined;
	}

	// Ensure actor has required tags
	if (!("name" in actor.tags)) {
		throw new Error(`Actor ${actor.id} missing 'name' in tags.`);
	}
	if (actor.tags.role !== "actor") {
		throw new Error(`Actor ${actor.id} does not have a actor role.`);
	}
	if (actor.tags.framework !== "rivetkit") {
		throw new Error(`Actor ${actor.id} is not an RivetKit actor.`);
	}

	return {
		name: actor.tags.name,
		key: deserializeKeyFromTag(actor.tags.key),
		endpoint: buildActorEndpoint(actor),
	};
}

function buildActorEndpoint(actor: RivetActor): string {
	// Fetch port
	const httpPort = actor.network.ports.http;
	if (!httpPort) throw new Error("missing http port");
	let hostname = httpPort.hostname;
	if (!hostname) throw new Error("missing hostname");
	const port = httpPort.port;
	if (!port) throw new Error("missing port");

	let isTls = false;
	switch (httpPort.protocol) {
		case "https":
			isTls = true;
			break;
		case "http":
		case "tcp":
			isTls = false;
			break;
		case "tcp_tls":
		case "udp":
			throw new Error(`Invalid protocol ${httpPort.protocol}`);
		default:
			assertUnreachable(httpPort.protocol as never);
	}

	const path = httpPort.path ?? "";

	// HACK: Fix hostname inside of Docker Compose
	if (hostname === "127.0.0.1") hostname = "rivet-guard";

	return `${isTls ? "https" : "http"}://${hostname}:${port}${path}`;
}

export function flushCache() {
	ACTOR_META_CACHE.clear();
	ACTOR_KEY_CACHE.clear();
}
