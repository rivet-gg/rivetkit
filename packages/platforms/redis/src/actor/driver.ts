import { GlobalState } from "@/router/mod";
import { Actor, Connection } from "actor-core";
import { ActorDriver, ConnectionDriver, AnyActor } from "actor-core/platform";
import Redis from "ioredis";
import { CachedSerializer } from "actor-core/actor/protocol/serde";
import { NodeMessage } from "@/node/protocol";
import * as messageToClient from "actor-core/actor/protocol/message/to_client";
import { logger } from "@/log";
import { KEYS, PUBSUB } from "@/redis";

function serializeKey(actorId: string, key: any): string {
	return KEYS.ACTOR.kv(actorId, JSON.stringify(key));
}

//function deserializeKey(key: any): string {
//	return JSON.parse(key);
//}

export function buildActorLeaderDriver(
	redis: Redis,
	globalState: GlobalState,
	actorId: string,
	actor: Actor,
): ActorDriver {
	// TODO: Use a better key serialization format
	return {
		connectionDrivers: {
			[CONN_DRIVER_RELAY_REDIS]: buildRelayRedisDriver(
				redis,
				globalState,
			),
		},

		async kvGet(key: any): Promise<any> {
			const value = await redis.get(serializeKey(actorId, key));
			if (value) return JSON.parse(value);
			else null;
		},

		async kvGetBatch(keys: any[]): Promise<[any, any][]> {
			let values = await redis.mget(keys.map((k) => serializeKey(actorId, k)));
			return values.map((v, i) => {
				if (v !== null) return [keys[i], JSON.parse(v)];
				else return [keys[i], null];
			});
		},

		async kvPut(key: any, value: any): Promise<void> {
			await redis.set(serializeKey(actorId, key), JSON.stringify(value));
		},

		async kvPutBatch(keys: [any, any][]): Promise<void> {
			await redis.mset(
				Object.fromEntries(
					keys.map(([k, v]) => [serializeKey(actorId, k), JSON.stringify(v)]),
				),
			);
		},

		async kvDelete(key: any): Promise<void> {
			await redis.del(key);
		},

		async kvDeleteBatch(keys: any[]): Promise<void> {
			await redis.del(keys.map((k) => serializeKey(actorId, k)));
		},

		async setAlarm(timestamp: number): Promise<void> {
			const timeout = Math.max(0, timestamp - Date.now());
			setTimeout(() => {
				actor.__onAlarm();
			}, timeout);
		},
	};
}

export const CONN_DRIVER_RELAY_REDIS = "relayRedis";

export interface RelayRedisState {
	nodeId: string;
}

function buildRelayRedisDriver(
	redis: Redis,
	globalState: GlobalState,
): ConnectionDriver<RelayRedisState> {
	return {
		sendMessage: (
			actor: AnyActor,
			conn: Connection<AnyActor>,
			state: RelayRedisState,
			message: CachedSerializer<messageToClient.ToClient>,
		) => {
			const actorPeer = globalState.actorPeers.get(actor.id);
			if (!actorPeer) {
				logger().warn("missing actor for message", { actorId: actor.id });
				return;
			}

			// Forward outoging message
			const messageRaw: NodeMessage = {
				b: {
					fm: {
						ci: conn.id,
						m: message.rawData,
					},
				},
			};
			redis.publish(PUBSUB.node(state.nodeId), JSON.stringify(messageRaw));
		},
		disconnect: async (
			actor: AnyActor,
			conn: Connection<AnyActor>,
			state: RelayRedisState,
			reason?: string,
		) => {
			if (actor.__isStopping) return;

			const actorPeer = globalState.actorPeers.get(actor.id);
			if (!actorPeer) {
				logger().warn("missing actor for disconnect", { actorId: actor.id });
				return;
			}

			// Forward close message
			const messageRaw: NodeMessage = {
				b: {
					fcc: {
						ci: conn.id,
						r: reason,
					},
				},
			};
			redis.publish(PUBSUB.node(state.nodeId), JSON.stringify(messageRaw));
		},
	};
}
