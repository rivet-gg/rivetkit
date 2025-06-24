import { assertUnreachable } from "@rivetkit/core/utils";
import { RivetActor, RivetClientConfig, rivetRequest } from "./rivet-client";
import { deserializeKeyFromTag, convertKeyToRivetTags } from "./util";
import invariant from "invariant";

interface WorkerMeta {
	name: string;
	key: string[];
	endpoint: string;
}

interface WorkerMetaWithId extends WorkerMeta {
	workerId: string;
}

// TODO: Implement LRU cache
// Cache for worker ID -> worker meta
const WORKER_META_CACHE = new Map<string, Promise<WorkerMeta | undefined>>();

// TODO: Implement LRU cache
// Cache for worker name+key -> worker ID
const WORKER_KEY_CACHE = new Map<string, Promise<string | undefined>>();

/**
 * Creates a cache key for worker name and key combination.
 */
function createKeysCacheKey(name: string, key: string[]): string {
	return `${name}:${JSON.stringify(key)}`;
}

/**
 * Returns worker metadata with an in-memory cache.
 */
export async function getWorkerMeta(
	clientConfig: RivetClientConfig,
	workerId: string,
): Promise<WorkerMeta | undefined> {
	// TODO: This does not refresh cache when workers are destroyed. This
	// will be replaced with hot pulls from the Rivet API once (a) worker
	// IDs include the datacenter in order to build endpoints without
	// hitting the API and (b) we update the API to hit the regional
	// endpoints.

	const workerMetaPromise = WORKER_META_CACHE.get(workerId);
	if (workerMetaPromise) {
		return await workerMetaPromise;
	} else {
		// Fetch meta
		const promise = (async () => {
			const { actor } = await rivetRequest<void, { actor: RivetActor }>(
				clientConfig,
				"GET",
				`/actors/${encodeURIComponent(workerId)}`,
			);

			return convertActorToMeta(actor);
		})();
		WORKER_META_CACHE.set(workerId, promise);

		// Remove from cache on failure so it can be retried
		promise.catch(() => {
			WORKER_META_CACHE.delete(workerId);
		});

		return await promise;
	}
}

/**
 * Returns worker metadata for a worker with the given name and key.
 */
export async function getWorkerMetaWithKey(
	clientConfig: RivetClientConfig,
	name: string,
	key: string[],
): Promise<WorkerMetaWithId | undefined> {
	const cacheKey = createKeysCacheKey(name, key);

	// Check if we have the worker ID cached
	const cachedWorkerIdPromise = WORKER_KEY_CACHE.get(cacheKey);
	if (cachedWorkerIdPromise) {
		const workerId = await cachedWorkerIdPromise;
		if (workerId) {
			// Try to get the worker metadata from the ID cache
			const meta = await getWorkerMeta(clientConfig, workerId);
			if (meta) {
				return {
					...meta,
					workerId,
				};
			}
			// If metadata is not available, remove from key cache and continue with fresh lookup
			WORKER_KEY_CACHE.delete(cacheKey);
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

		// Filter workers to ensure they're valid
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
			WORKER_KEY_CACHE.delete(cacheKey);

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

	WORKER_KEY_CACHE.set(cacheKey, promise);

	// Remove from cache on failure so it can be retried
	promise.catch(() => {
		WORKER_KEY_CACHE.delete(cacheKey);
	});

	const workerId = await promise;
	if (!workerId) {
		return undefined;
	}

	const meta = await getWorkerMeta(clientConfig, workerId);
	invariant(meta, "worker metadata should be available after populating cache");

	return {
		...meta,
		workerId,
	};
}

/**
 * Preemptively adds an entry to the cache.
 */
export function populateCache(actor: RivetActor): WorkerMeta | undefined {
	const meta = convertActorToMeta(actor);
	if (meta) {
		// Populate the worker ID -> metadata cache
		WORKER_META_CACHE.set(actor.id, Promise.resolve(meta));

		// Populate the name+key -> worker ID cache
		const cacheKey = createKeysCacheKey(meta.name, meta.key);
		WORKER_KEY_CACHE.set(cacheKey, Promise.resolve(actor.id));
	}
	return meta;
}

/**
 * Converts actor data from the Rivet API to worker metadata.
 */
function convertActorToMeta(actor: RivetActor): WorkerMeta | undefined {
	// Check if worker exists and not destroyed
	if (actor.destroyedAt) {
		return undefined;
	}

	// Ensure worker has required tags
	if (!("name" in actor.tags)) {
		throw new Error(`Worker ${actor.id} missing 'name' in tags.`);
	}
	if (actor.tags.role !== "worker") {
		throw new Error(`Worker ${actor.id} does not have a worker role.`);
	}
	if (actor.tags.framework !== "rivetkit") {
		throw new Error(`Worker ${actor.id} is not an RivetKit worker.`);
	}

	return {
		name: actor.tags.name,
		key: deserializeKeyFromTag(actor.tags.key),
		endpoint: buildWorkerEndpoint(actor),
	};
}

function buildWorkerEndpoint(actor: RivetActor): string {
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
	WORKER_META_CACHE.clear();
	WORKER_KEY_CACHE.clear();
}
