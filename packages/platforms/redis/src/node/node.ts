import { GlobalState } from "@/router/mod";
import { logger } from "@/log";
import {
	NodeMessage,
	NodeMessageSchema,
	ToFollowerConnectionClose,
	ToFollowerMessage,
	Ack,
	ToLeaderConnectionClose,
	ToLeaderConnectionOpen,
	ToLeaderMessage,
} from "@/node/protocol";
import { buildRedis } from "@/redis";
import { assertUnreachable } from "actor-core/platform";
import Redis from "ioredis";
import { ActorPeer } from "../actor/peer";
import { CONN_DRIVER_RELAY_REDIS, RelayRedisState } from "../actor/driver";
import { PUBSUB } from "@/redis";
import { RedisConfig } from "@/config";

export class Node {
	#redis: Redis;
	#globalState: GlobalState;

	/** Subscriber used for receiving node events. */
	#nodeSub: Redis;

	constructor(redis: Redis, config: RedisConfig, globalState: GlobalState) {
		this.#redis = redis;
		this.#globalState = globalState;

		this.#nodeSub = buildRedis(config);
	}

	async start() {
		logger().info("starting", { nodeId: this.#globalState.nodeId });

		// TODO: support binary
		this.#nodeSub.on("message", this.#onMessage.bind(this));

		// Subscribe to events
		//
		// We intentionally design this so there's only one topic for the subscriber to listen on in order to reduce chattiness to Redis.
		//
		// If we had a dedicated topic to Redis for each actor, we'd have to send a SUB for each leader & follower for each actor.
		//
		// Additionally, in most serverless environments, 1 node usually owns 1 actor, so this would double the RTT to create the required subscribers.
		await this.#nodeSub.subscribe(PUBSUB.node(this.#globalState.nodeId));

		logger().info("started successfully", { nodeId: this.#globalState.nodeId });
	}

	async #onMessage(_channel: string, message: string) {
		// TODO: try catch this
		// TODO: Support multiple protocols for the actor

		// Parse message
		const { data, success, error } = NodeMessageSchema.safeParse(
			JSON.parse(message),
		);
		if (!success) {
			throw new Error(`Invalid NodeMessage message: ${error}`);
		}

		// Ack message
		if (data.n && data.m) {
			if ("a" in data.b) {
				throw new Error("Ack messages cannot request ack in response");
			}

			const messageRaw: NodeMessage = {
				b: {
					a: {
						m: data.m,
					},
				},
			};
			this.#redis.publish(PUBSUB.node(data.n), JSON.stringify(messageRaw));
		}

		// Handle message
		if ("a" in data.b) {
			await this.#onAck(data.b.a);
		} else if ("lco" in data.b) {
			await this.#onLeaderConnectionOpen(data.n, data.b.lco);
		} else if ("lcc" in data.b) {
			await this.#onLeaderConnectionClose(data.b.lcc);
		} else if ("lm" in data.b) {
			await this.#onLeaderMessage(data.b.lm);
		} else if ("fcc" in data.b) {
			await this.#onFollowerConnectionClose(data.b.fcc);
		} else if ("fm" in data.b) {
			await this.#onFollowerMessage(data.b.fm);
		} else {
			assertUnreachable(data.b);
		}
	}

	async #onAck({ m: messageId }: Ack) {
		const resolveAck = this.#globalState.messageAckResolvers.get(messageId);
		if (resolveAck) {
			resolveAck();
			this.#globalState.messageAckResolvers.delete(messageId);
		} else {
			logger().warn("missing ack resolver", { messageId });
		}
	}

	async #onLeaderConnectionOpen(
		nodeId: string | undefined,
		{
			ai: actorId,
			ci: connId,
			ct: connToken,
			p: connParams,
		}: ToLeaderConnectionOpen,
	) {
		if (!nodeId) {
			logger().error("node id not provided for leader connection open event");
			return;
		}

		logger().debug("received connection open", { actorId, connId });

		// Connection open

		try {
			// TODO: Encoding doesn't matter because we don't manually ser/de at the actor level
			const encoding = "json";

			const actor = ActorPeer.getLeaderActor(this.#globalState, actorId);
			if (!actor) {
				logger().warn("received message for nonexistent actor leader", {
					actorId,
				});
				return;
			}

			const connState = await actor.__prepareConnection(connParams);
			await actor.__createConnection(
				connId,
				connToken,
				connParams,
				connState,
				CONN_DRIVER_RELAY_REDIS,
				{ nodeId } satisfies RelayRedisState,
			);

			// Connection init will be sent by `Actor`
		} catch (error) {
			logger().warn("failed to open connection", { error: `${error}` });

			// TODO: We don't have the connection ID
			// Forward close message
			//const message: ToFollower = {
			//	b: {
			//		cc: {
			//			ci: `${conn.id}`,
			//			r: `Error: ${error}`,
			//		},
			//	},
			//};
			//redis.publish(
			//	PUBSUB.ACTOR.follower(actorId, followerId),
			//	JSON.stringify(message),
			//);
		}
	}

	async #onLeaderConnectionClose({
		ai: actorId,
		ci: connId,
	}: ToLeaderConnectionClose) {
		logger().debug("received connection close", { actorId });

		const actor = ActorPeer.getLeaderActor(this.#globalState, actorId);
		if (!actor) {
			logger().warn("received message for nonexistent actor leader", {
				actorId,
			});
			return;
		}

		const conn = actor.__getConnectionForId(connId);
		if (conn) {
			actor.__removeConnection(conn);
		} else {
			logger().warn("received connection close for nonexisting connection", {
				connId,
			});
		}
	}

	async #onLeaderMessage({
		ai: actorId,
		ci: connId,
		ct: connToken,
		m: message,
	}: ToLeaderMessage) {
		logger().debug("received connection message", { actorId, connId });

		// Get leader
		const actor = ActorPeer.getLeaderActor(this.#globalState, actorId);
		if (!actor) {
			logger().warn("received message for nonexistent actor leader", {
				actorId,
			});
			return;
		}

		// Get connection
		const conn = actor.__getConnectionForId(connId);
		if (conn) {
			// Validate token
			if (conn._token !== connToken) {
				throw new Error("connection token does not match");
			}

			// Process message
			await actor.__processMessage(message, conn);
		} else {
			logger().warn("received message for nonexisting connection", {
				connId,
			});
		}
	}

	async #onFollowerConnectionClose({
		ci: connId,
		r: reason,
	}: ToFollowerConnectionClose) {
		const conn = this.#globalState.relayConnections.get(connId);
		if (!conn) {
			logger().warn("missing connection", { connId });
			return;
		}

		conn.disconnect(true, reason);
	}

	async #onFollowerMessage({ ci: connId, m: message }: ToFollowerMessage) {
		const conn = this.#globalState.relayConnections.get(connId);
		if (!conn) {
			logger().warn("missing connection", { connId });
			return;
		}

		conn.onMessage(message);
	}
}
