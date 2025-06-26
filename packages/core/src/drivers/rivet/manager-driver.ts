import type { ConnRoutingHandler } from "@/actor/conn-routing-handler";
import { ActorAlreadyExists, InternalError } from "@/actor/errors";
import type {
	ActorOutput,
	CreateInput,
	GetForIdInput,
	GetOrCreateWithKeyInput,
	GetWithKeyInput,
	ManagerDriver,
} from "@/driver-helpers/mod";
import type { RegistryConfig } from "@/registry/mod";
import { getEnvUniversal } from "@/utils";
import type { Hono } from "hono";
import invariant from "invariant";
import {
	flushCache,
	getActorMeta,
	getActorMetaWithKey,
	populateCache,
} from "./actor-meta";
import { createRivetConnRoutingHandler } from "./conn-routing-handler";
import { logger } from "./log";
import {
	type RivetActor,
	type RivetClientConfig,
	rivetRequest,
} from "./rivet-client";
import { convertKeyToRivetTags } from "./util";
import * as cbor from "cbor-x";

export interface ActorState {
	key: string[];
	destroyedAt?: number;
}

export interface GetActorMeta {
	endpoint: string;
}

export class RivetManagerDriver implements ManagerDriver {
	#clientConfig: RivetClientConfig;

	readonly connRoutingHandler: ConnRoutingHandler;

	constructor(clientConfig: RivetClientConfig) {
		this.#clientConfig = clientConfig;

		this.connRoutingHandler = createRivetConnRoutingHandler(clientConfig);
	}

	async getForId({ actorId }: GetForIdInput): Promise<ActorOutput | undefined> {
		try {
			const meta = await getActorMeta(this.#clientConfig, actorId);
			if (!meta) return undefined;

			return {
				actorId,
				name: meta.name,
				key: meta.key,
			};
		} catch (error) {
			// TODO: Handle not found or other errors gracefully
			return undefined;
		}
	}

	async getWithKey({
		name,
		key,
	}: GetWithKeyInput): Promise<ActorOutput | undefined> {
		const meta = await getActorMetaWithKey(this.#clientConfig, name, key);
		if (!meta) return undefined;

		return {
			actorId: meta.actorId,
			name: meta.name,
			key: meta.key,
		};
	}

	async getOrCreateWithKey(
		input: GetOrCreateWithKeyInput,
	): Promise<ActorOutput> {
		const getOutput = await this.getWithKey(input);
		if (getOutput) {
			return getOutput;
		} else {
			return await this.createActor(input);
		}
	}

	async createActor({
		name,
		key,
		region,
		input,
	}: CreateInput): Promise<ActorOutput> {
		// Check if actor with the same name and key already exists
		const existingActor = await this.getWithKey({ name, key });
		if (existingActor) {
			throw new ActorAlreadyExists(name, key);
		}

		// Create the actor request
		const actorLogLevel: string | undefined =
			getEnvUniversal("_ACTOR_LOG_LEVEL");

		const createRequest = {
			tags: convertKeyToRivetTags(name, key),
			build_tags: {
				role: "actor",
				framework: "rivetkit",
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
				environment: {
					RIVETKIT_DRIVER: "rivet",
					RIVET_ENDPOINT: this.#clientConfig.endpoint,
					RIVET_SERVICE_TOKEN: this.#clientConfig.token,
					RIVET_PROJECT: this.#clientConfig.project,
					RIVET_ENVIRONMENT: this.#clientConfig.environment,
					...(actorLogLevel ? { _LOG_LEVEL: actorLogLevel } : {}),
				},
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

		const meta = populateCache(actor);
		invariant(meta, "actor just created, should not be destroyed");

		// Initialize the actor
		try {
			const url = `${meta.endpoint}/initialize`;
			logger().debug("initializing actor", {
				url,
				input: JSON.stringify(input),
			});

			const res = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/cbor",
				},
				body: cbor.encode({ input }),
			});
			if (!res.ok) {
				throw new InternalError(
					`Actor initialize request failed (${res.status}):\n${await res.text()}`,
				);
			}
		} catch (error) {
			logger().error("failed to initialize actor, destroying actor", {
				actorId: actor.id,
				error,
			});

			// Destroy the actor since it failed to initialize
			await rivetRequest<typeof createRequest, { actor: RivetActor }>(
				this.#clientConfig,
				"DELETE",
				`/actors/${actor.id}`,
			);

			throw error;
		}

		return {
			actorId: actor.id,
			name: meta.name,
			key: meta.key,
		};
	}

	modifyManagerRouter(registryConfig: RegistryConfig, router: Hono) {
		// HACK: Expose endpoint for tests to flush cache
		if (registryConfig.test.enabled) {
			router.post("/.test/rivet/flush-cache", (c) => {
				flushCache();
				return c.text("ok");
			});
		}
	}
}
