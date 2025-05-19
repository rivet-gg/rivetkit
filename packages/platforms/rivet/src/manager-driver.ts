import { assertUnreachable } from "actor-core/utils";
import type {
	ManagerDriver,
	GetForIdInput,
	GetWithKeyInput,
	CreateActorInput,
	GetActorOutput,
} from "actor-core/driver-helpers";
import { logger } from "./log";
import { type RivetClientConfig, rivetRequest } from "./rivet-client";
import { serializeKeyForTag, deserializeKeyFromTag } from "./util";

export interface ActorState {
	key: string[];
	destroyedAt?: number;
}

export interface GetActorMeta {
	endpoint: string;
}

export class RivetManagerDriver implements ManagerDriver {
	#clientConfig: RivetClientConfig;

	constructor(clientConfig: RivetClientConfig) {
		this.#clientConfig = clientConfig;
	}

	async getForId({
		actorId,
	}: GetForIdInput): Promise<GetActorOutput | undefined> {
		try {
			// Get actor
			const res = await rivetRequest<void, { actor: RivetActor }>(
				this.#clientConfig,
				"GET",
				`/actors/${encodeURIComponent(actorId)}`,
			);

			// Check if actor exists and not destroyed
			if (res.actor.destroyedAt) {
				return undefined;
			}

			// Ensure actor has required tags
			if (!("name" in res.actor.tags)) {
				throw new Error(`Actor ${res.actor.id} missing 'name' in tags.`);
			}
			if (res.actor.tags.role !== "actor") {
				throw new Error(`Actor ${res.actor.id} does not have an actor role.`);
			}
			if (res.actor.tags.framework !== "actor-core") {
				throw new Error(`Actor ${res.actor.id} is not an ActorCore actor.`);
			}

			return {
				actorId: res.actor.id,
				name: res.actor.tags.name,
				key: this.#extractKeyFromRivetTags(res.actor.tags),
				meta: {
					endpoint: buildActorEndpoint(res.actor),
				} satisfies GetActorMeta,
			};
		} catch (error) {
			// Handle not found or other errors
			return undefined;
		}
	}

	async getWithKey({
		name,
		key,
	}: GetWithKeyInput): Promise<GetActorOutput | undefined> {
		// Convert key array to Rivet's tag format
		const rivetTags = this.#convertKeyToRivetTags(name, key);

		// Query actors with matching tags
		const { actors } = await rivetRequest<void, { actors: RivetActor[] }>(
			this.#clientConfig,
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
			return undefined;
		}

		// For consistent results, sort by ID if multiple actors match
		const actor =
			validActors.length > 1
				? validActors.sort((a, b) => a.id.localeCompare(b.id))[0]
				: validActors[0];

		// Ensure actor has required tags
		if (!("name" in actor.tags)) {
			throw new Error(`Actor ${actor.id} missing 'name' in tags.`);
		}

		return {
			actorId: actor.id,
			name: actor.tags.name,
			key: this.#extractKeyFromRivetTags(actor.tags),
			meta: {
				endpoint: buildActorEndpoint(actor),
			} satisfies GetActorMeta,
		};
	}

	async createActor({
		name,
		key,
		region,
	}: CreateActorInput): Promise<GetActorOutput> {
		// Create the actor request
		let actorLogLevel: string | undefined = undefined;
		if (typeof Deno !== "undefined") {
			actorLogLevel = Deno.env.get("_ACTOR_LOG_LEVEL");
		} else if (typeof process !== "undefined") {
			// Do this after Deno since `process` is sometimes polyfilled
			actorLogLevel = process.env._ACTOR_LOG_LEVEL;
		}

		const createRequest = {
			tags: this.#convertKeyToRivetTags(name, key),
			build_tags: {
				name,
				role: "actor",
				framework: "actor-core",
				current: "true",
			},
			region,
			network: {
				ports: {
					http: {
						protocol: "https",
						routing: { guard: {} },
					},
				},
			},
			runtime: {
				environment: actorLogLevel
					? {
							_LOG_LEVEL: actorLogLevel,
						}
					: {},
			},
			lifecycle: {
				durable: true,
			},
		};

		logger().info("creating actor", { ...createRequest });

		// Create the actor
		const { actor } = await rivetRequest<
			typeof createRequest,
			{ actor: RivetActor }
		>(this.#clientConfig, "POST", "/actors", createRequest);

		return {
			actorId: actor.id,
			name,
			key: this.#extractKeyFromRivetTags(actor.tags),
			meta: {
				endpoint: buildActorEndpoint(actor),
			} satisfies GetActorMeta,
		};
	}

	// Helper method to convert a key array to Rivet's tag-based format
	#convertKeyToRivetTags(name: string, key: string[]): Record<string, string> {
		return {
			name,
			key: serializeKeyForTag(key),
			role: "actor",
			framework: "actor-core",
		};
	}

	// Helper method to extract key array from Rivet's tag-based format
	#extractKeyFromRivetTags(tags: Record<string, string>): string[] {
		return deserializeKeyFromTag(tags.key);
	}

	async #getBuildWithTags(
		buildTags: Record<string, string>,
	): Promise<RivetBuild | undefined> {
		// Query builds with matching tags
		const { builds } = await rivetRequest<void, { builds: RivetBuild[] }>(
			this.#clientConfig,
			"GET",
			`/builds?tags_json=${encodeURIComponent(JSON.stringify(buildTags))}`,
		);

		if (builds.length === 0) {
			return undefined;
		}

		// For consistent results, sort by ID if multiple builds match
		return builds.length > 1
			? builds.sort((a, b) => a.id.localeCompare(b.id))[0]
			: builds[0];
	}
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

// biome-ignore lint/suspicious/noExplicitAny: will add api types later
type RivetActor = any;
// biome-ignore lint/suspicious/noExplicitAny: will add api types later
type RivetBuild = any;
