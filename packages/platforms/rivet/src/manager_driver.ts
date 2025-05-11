
export interface ActorState {
	key: string[];
	destroyedAt?: number;
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

			// Check if actor exists, is public, and not destroyed
			if ((res.actor.tags as Record<string, string>).access !== "public" || res.actor.destroyedAt) {
				return undefined;
			}

			// Ensure actor has required tags
			if (!("name" in res.actor.tags)) {
				throw new Error(`Actor ${res.actor.id} missing 'name' in tags.`);
			}

			return {
				endpoint: buildActorEndpoint(res.actor),
				name: res.actor.tags.name,
				key: this.#extractKeyFromRivetTags(res.actor.tags),
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
			// Verify actor is public
			if ((a.tags as Record<string, string>).access !== "public") {
				return false;
			}

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
		const actor = validActors.length > 1 
			? validActors.sort((a, b) => a.id.localeCompare(b.id))[0]
			: validActors[0];

		// Ensure actor has required tags
		if (!("name" in actor.tags)) {
			throw new Error(`Actor ${actor.id} missing 'name' in tags.`);
		}

		return {
			endpoint: buildActorEndpoint(actor),
			name: actor.tags.name,
			key: this.#extractKeyFromRivetTags(actor.tags),
		};
	}

	async createActor({
		name,
		key,
		region,
	}: CreateActorInput): Promise<GetActorOutput> {
		// Find a matching build that's public and current
		const build = await this.#getBuildWithTags({
			name,
			current: "true",
			access: "public",
		});
		
		if (!build) {
			throw new Error("Build not found with tags or is private");
		}

		// Create the actor request
		const createRequest = {
			tags: this.#convertKeyToRivetTags(name, key),
			build: build.id,
			region,
			network: {
				ports: {
					http: {
						protocol: "https",
						routing: { guard: {} },
					},
				},
			},
		};

		logger().info("creating actor", { ...createRequest });
		
		// Create the actor
		const { actor } = await rivetRequest<typeof createRequest, { actor: RivetActor }>(
			this.#clientConfig,
			"POST",
			"/actors",
			createRequest,
		);

		return {
			endpoint: buildActorEndpoint(actor),
			name,
			key: this.#extractKeyFromRivetTags(actor.tags),
		};
	}

	// Helper method to convert a key array to Rivet's tag-based format
	#convertKeyToRivetTags(name: string, key: string[]): Record<string, string> {
		return {
			name,
			access: "public",
			key: serializeKeyForTag(key),
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

		// Filter to public builds
		const publicBuilds = builds.filter(b => b.tags.access === "public");
		
		if (publicBuilds.length === 0) {
			return undefined;
		}
		
		// For consistent results, sort by ID if multiple builds match
		return publicBuilds.length > 1
			? publicBuilds.sort((a, b) => a.id.localeCompare(b.id))[0]
			: publicBuilds[0];
	}
}

function buildActorEndpoint(actor: RivetActor): string {
	// Fetch port
	const httpPort = actor.network.ports.http;
	if (!httpPort) throw new Error("missing http port");
	const hostname = httpPort.hostname;
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

	return `${isTls ? "https" : "http"}://${hostname}:${port}${path}`;
}

import { assertUnreachable } from "actor-core/utils";
import type { ActorKey } from "actor-core";
import {
	ManagerDriver,
	GetForIdInput,
	GetWithKeyInput,
	CreateActorInput,
	GetActorOutput,
} from "actor-core/driver-helpers";
import { logger } from "./log";
import { type RivetClientConfig, rivetRequest } from "./rivet_client";
import { serializeKeyForTag, deserializeKeyFromTag } from "./util";

// biome-ignore lint/suspicious/noExplicitAny: will add api types later
type RivetActor = any;
// biome-ignore lint/suspicious/noExplicitAny: will add api types later
type RivetBuild = any;