import {
	type ActorRouter,
	createActorRouter,
	createClientWithDriver,
	createInlineClientDriver,
	type Encoding,
	type RegistryConfig,
	type RunConfig,
} from "@rivetkit/core";
import {
	type ActorDriver,
	type ActorOutput,
	type CreateInput,
	type GetForIdInput,
	type GetOrCreateWithKeyInput,
	type GetWithKeyInput,
	type ManagerDriver,
	serializeEmptyPersistData,
} from "@rivetkit/core/driver-helpers";
import { ActorAlreadyExists } from "@rivetkit/core/errors";
import * as cbor from "cbor-x";
import type { Context as HonoContext } from "hono";
import invariant from "invariant";
import type Redis from "ioredis";
import type { RedisDriverConfig } from "./config";
import type { Node } from "./coordinate/node/mod";
import { KEYS } from "./keys";
import { logger } from "./log";
import { generateActorId } from "./utils";

export class RedisManagerDriver implements ManagerDriver {
	#registryConfig: RegistryConfig;
	#driverConfig: RedisDriverConfig;
	#redis: Redis;
	#node!: Node;

	// inspector: ManagerInspector = new ManagerInspector(this, {
	// 	getAllActors: () => this.#state.getAllActors(),
	// 	getAllTypesOfActors: () => Object.keys(this.registry.config.actors),
	// });

	constructor(
		registryConfig: RegistryConfig,
		driverConfig: RedisDriverConfig,
		redis: Redis,
	) {
		this.#registryConfig = registryConfig;
		this.#driverConfig = driverConfig;
		this.#redis = redis;
	}

	get node(): Node {
		invariant(this.#node, "node should exist");
		return this.#node;
	}

	set node(node: Node) {
		invariant(!this.#node, "node cannot be set twice");
		this.#node = node;
	}

	async getForId({ actorId }: GetForIdInput): Promise<ActorOutput | undefined> {
		// Get metadata from Redis
		const metadataRaw = await this.#redis.getBuffer(
			KEYS.ACTOR.metadata(this.#driverConfig.keyPrefix, actorId),
		);

		// If the actor doesn't exist, return undefined
		if (!metadataRaw) {
			return undefined;
		}

		const metadata = cbor.decode(metadataRaw);
		const { name, key } = metadata;

		return {
			actorId,
			name,
			key,
		};
	}

	async getWithKey({
		name,
		key,
	}: GetWithKeyInput): Promise<ActorOutput | undefined> {
		// Since keys are 1:1 with actor IDs, we can directly look up by key
		const lookupKey = KEYS.actorByKey(this.#driverConfig.keyPrefix, name, key);
		const actorId = await this.#redis.get(lookupKey);

		if (!actorId) {
			return undefined;
		}

		return this.getForId({ actorId });
	}

	async getOrCreateWithKey(
		input: GetOrCreateWithKeyInput,
	): Promise<ActorOutput> {
		const { name, key } = input;
		const actorId = generateActorId(input.name, input.key);

		// Write actor
		const pipeline = this.#redis.multi();
		pipeline.setnx(
			KEYS.actorByKey(this.#driverConfig.keyPrefix, name, key),
			actorId,
		);
		pipeline.setnx(
			KEYS.ACTOR.metadata(this.#driverConfig.keyPrefix, actorId),
			cbor.encode({ name, key }),
		);
		pipeline.setnx(
			KEYS.ACTOR.persistedData(this.#driverConfig.keyPrefix, actorId),
			Buffer.from(serializeEmptyPersistData(input.input)),
		);

		const results = await pipeline.exec();
		if (!results) {
			throw new Error("redis pipeline execution failed");
		}

		const keyCreated = results[0]?.[1] as number;
		const metadataCreated = results[1]?.[1] as number;
		const persistedDataCreated = results[2]?.[1] as number;
		invariant(
			metadataCreated === keyCreated,
			"metadataCreated inconsistent with keyCreated",
		);
		invariant(
			persistedDataCreated === keyCreated,
			"persistedDataCreated inconsistent with keyCreated",
		);

		// If we created the actor, we have the metadata
		if (keyCreated === 1) {
			logger().debug("actor created", { actorId });
		} else {
			logger().debug("actor already exists", { actorId });
		}

		return {
			actorId,
			name: input.name,
			key: input.key,
		};
	}

	async createActor({ name, key, input }: CreateInput): Promise<ActorOutput> {
		const actorId = generateActorId(name, key);

		// Write actor
		const pipeline = this.#redis.multi();
		pipeline.setnx(
			KEYS.actorByKey(this.#driverConfig.keyPrefix, name, key),
			actorId,
		);
		pipeline.setnx(
			KEYS.ACTOR.metadata(this.#driverConfig.keyPrefix, actorId),
			cbor.encode({ name, key }),
		);
		pipeline.setnx(
			KEYS.ACTOR.persistedData(this.#driverConfig.keyPrefix, actorId),
			Buffer.from(serializeEmptyPersistData(input)),
		);
		const results = await pipeline.exec();
		if (!results) {
			throw new Error("redis pipeline execution failed");
		}

		// Check all SETNX results
		const keyResult = results[0]?.[1];
		const metadataResult = results[1]?.[1];
		const persistedDataResult = results[2]?.[1];
		invariant(
			metadataResult === keyResult,
			"metadataResult inconsistent with keyResult",
		);
		invariant(
			persistedDataResult === keyResult,
			"metadataResult inconsistent with keyResult",
		);

		// If the actor key already existed, it's an error
		if (keyResult === 0) {
			throw new ActorAlreadyExists(name, key);
		}

		// Notify inspector of actor creation
		// this.inspector.onActorsChange([
		// 	{
		// 		id: actorId,
		// 		name,
		// 		key,
		// 	},
		// ]);

		return {
			actorId,
			name,
			key,
		};
	}

	async sendRequest(actorId: string, actorRequest: Request): Promise<Response> {
		return await this.#node.sendRequest(actorId, actorRequest);
	}

	async openWebSocket(
		path: string,
		actorId: string,
		encoding: Encoding,
		connParams: unknown,
	): Promise<WebSocket> {
		logger().debug("RedisManagerDriver.openWebSocket called", {
			path,
			actorId,
			encoding,
		});
		return await this.#node.openWebSocket(path, actorId, encoding, connParams);
	}

	async proxyRequest(
		c: HonoContext,
		actorRequest: Request,
		actorId: string,
	): Promise<Response> {
		return await this.#node.proxyRequest(c, actorRequest, actorId);
	}

	async proxyWebSocket(
		c: HonoContext,
		path: string,
		actorId: string,
		encoding: Encoding,
		connParams: unknown,
		authData: unknown,
	): Promise<Response> {
		return await this.#node.proxyWebSocket(
			c,
			path,
			actorId,
			encoding,
			connParams,
			authData,
		);
	}
}
