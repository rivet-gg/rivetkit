import type {
	GenericConnGlobalState,
	RegistryConfig,
	RunConfig,
} from "@rivetkit/core";
import type {
	ActorDriver,
	AnyActorInstance,
	ManagerDriver,
} from "@rivetkit/core/driver-helpers";
import invariant from "invariant";
import type Redis from "ioredis";
import type { RedisDriverConfig } from "./config";
import { ActorPeer } from "./coordinate/actor-peer";
import type { Node } from "./coordinate/node/mod";
import type { GlobalState } from "./coordinate/types";
import { KEYS } from "./keys";
import { logger } from "./log";

// Define AnyClient locally since it's not exported
type AnyClient = any;

export interface ActorDriverContext {
	redis: Redis;
}

/**
 * Redis implementation of the Actor Driver
 */
export class RedisActorDriver implements ActorDriver {
	#globalState: GlobalState;
	#redis: Redis;
	#driverConfig: RedisDriverConfig;

	constructor(
		globalState: GlobalState,
		redis: Redis,
		driverConfig: RedisDriverConfig,
	) {
		this.#globalState = globalState;
		this.#redis = redis;
		this.#driverConfig = driverConfig;
	}

	async loadActor(actorId: string): Promise<AnyActorInstance> {
		const actor = await ActorPeer.getLeaderActor(this.#globalState, actorId);
		invariant(actor, `Actor ${actorId} is not the leader on this node`);
		return actor;
	}

	getGenericConnGlobalState(actorId: string): GenericConnGlobalState {
		const peer = ActorPeer.getLeaderActorPeer(this.#globalState, actorId);
		invariant(peer, `Actor ${actorId} is not the leader on this node`);
		return peer.genericConnGlobalState;
	}

	getContext(_actorId: string): ActorDriverContext {
		return { redis: this.#redis };
	}

	async readPersistedData(actorId: string): Promise<Uint8Array | undefined> {
		const data = await this.#redis.getBuffer(
			KEYS.ACTOR.persistedData(this.#driverConfig.keyPrefix, actorId),
		);
		if (data !== null) return data;
		return undefined;
	}

	async writePersistedData(actorId: string, data: Uint8Array): Promise<void> {
		await this.#redis.set(
			KEYS.ACTOR.persistedData(this.#driverConfig.keyPrefix, actorId),
			Buffer.from(data),
		);
	}

	async setAlarm(actor: AnyActorInstance, timestamp: number): Promise<void> {
		logger().warn(
			"redis driver currently does not support scheduling. alarms are currently implemented with setTimeout and will not survive sleeping.replaced with setTimeout.",
			{ issue: "https://github.com/rivet-gg/rivetkit/issues/1095" },
		);
		const delay = Math.max(timestamp - Date.now(), 0);
		setTimeout(() => {
			actor.onAlarm();
		}, delay);
	}

	getDatabase(actorId: string): Promise<unknown | undefined> {
		return Promise.resolve(undefined);
	}
}
