import { assertUnreachable } from "actor-core/utils";
import type { ActorTags, BuildTags } from "actor-core";
import {
	ManagerDriver,
	GetForIdInput,
	GetWithTagsInput,
	CreateActorInput,
	GetActorOutput,
} from "actor-core/driver-helpers";
import { logger } from "./log";
import { type RivetClientConfig, rivetRequest } from "./rivet_client";

// biome-ignore lint/suspicious/noExplicitAny: will add api types later
type RivetActor = any;
// biome-ignore lint/suspicious/noExplicitAny: will add api types later
type RivetBuild = any;

export interface ActorState {
	tags: ActorTags;
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

			// Check if actor exists and is public
			if ((res.actor.tags as ActorTags).access !== "public") {
				return undefined;
			}

			// Check if actor is destroyed
			if (res.actor.destroyedAt) {
				return undefined;
			}

			return {
				endpoint: buildActorEndpoint(res.actor),
				tags: res.actor.tags as ActorTags,
			};
		} catch (error) {
			// Handle not found or other errors
			return undefined;
		}
	}

	async getWithTags({
		tags,
	}: GetWithTagsInput): Promise<GetActorOutput | undefined> {
		const tagsJson = JSON.stringify({
			...tags,
			access: "public",
		});
		let { actors } = await rivetRequest<void, { actors: RivetActor[] }>(
			this.#clientConfig,
			"GET",
			`/actors?tags_json=${encodeURIComponent(tagsJson)}`,
		);

		// TODO(RVT-4248): Don't return actors that aren't networkable yet
		actors = actors.filter((a: RivetActor) => {
			// This should never be triggered. This assertion will leak if private actors exist if it's ever triggered.
			if ((a.tags as ActorTags).access !== "public") {
				throw new Error("unreachable: actor tags not public");
			}

			for (const portName in a.network.ports) {
				const port = a.network.ports[portName];
				if (!port.hostname || !port.port) return false;
			}
			return true;
		});

		if (actors.length === 0) {
			return undefined;
		}

		// Make the chosen actor consistent
		if (actors.length > 1) {
			actors.sort((a: RivetActor, b: RivetActor) => a.id.localeCompare(b.id));
		}

		return {
			endpoint: buildActorEndpoint(actors[0]),
			tags: actors[0].tags as ActorTags,
		};
	}

	async createActor({
		name,
		tags,
		region,
	}: CreateActorInput): Promise<GetActorOutput> {
		// Verify build access
		const build = await this.#getBuildWithTags({
			name: name,
			current: "true",
			access: "public",
		});
		if (!build) throw new Error("Build not found with tags or is private");

		// Create actor
		const req = {
			tags: {
				...tags,
				access: "public",
			},
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
		logger().info("creating actor", { ...req });
		const { actor } = await rivetRequest<typeof req, { actor: RivetActor }>(
			this.#clientConfig,
			"POST",
			"/actors",
			req,
		);

		return {
			endpoint: buildActorEndpoint(actor),
			tags: actor.tags as ActorTags,
		};
	}

	async #getBuildWithTags(
		buildTags: BuildTags,
	): Promise<RivetBuild | undefined> {
		const tagsJson = JSON.stringify(buildTags);
		let { builds } = await rivetRequest<void, { builds: RivetBuild[] }>(
			this.#clientConfig,
			"GET",
			`/builds?tags_json=${encodeURIComponent(tagsJson)}`,
		);

		builds = builds.filter((b: RivetBuild) => {
			// Filter out private builds
			if ((b.tags as BuildTags).access !== "public") return false;

			return true;
		});

		if (builds.length === 0) {
			return undefined;
		}
		if (builds.length > 1) {
			builds.sort((a: RivetBuild, b: RivetBuild) => a.id.localeCompare(b.id));
		}

		return builds[0];
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
