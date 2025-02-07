import { createActorRouter, Manager } from "actor-core/platform";
import { GlobalState } from "@/router/mod";
import Redis from "ioredis";
import { logger } from "@/log";
import * as messageToServer from "actor-core/actor/protocol/message/to_server";
import { RedisConfig, DEFAULT_ACTOR_PEER_MESSAGE_ACK_TIMEOUT } from "@/config";
import { NodeMessage } from "@/node/protocol";
import pRetry, { AbortError } from "p-retry";
import { KEYS, PUBSUB } from "@/redis";

/**
 * Publishes a message and waits for an ack. If no ack is received, then retries accordingly.
 *
 * This should be used any time a message to the leader is being published since it correctly handles leadership transfer edge cases.
 */
export async function publishMessageToLeader(
	redis: Redis,
	config: RedisConfig,
	globalState: GlobalState,
	actorId: string,
	message: NodeMessage,
	signal?: AbortSignal,
) {
	// Include node
	message.n = globalState.nodeId;

	// Add message ID for ack
	const messageId = crypto.randomUUID();
	message.m = messageId;

	// Retry publishing message
	await pRetry(
		() =>
			publishMessageToLeaderInner(
				redis,
				config,
				globalState,
				actorId,
				messageId,
				message,
				signal,
			),
		{
			signal,
			minTimeout: 1000,
			retries: 5,
			onFailedAttempt: (error) => {
				logger().warn("error publishing message", {
					attempt: error.attemptNumber,
					error: error.message,
				});
			},
		},
	);
}

async function publishMessageToLeaderInner(
	redis: Redis,
	config: RedisConfig,
	globalState: GlobalState,
	actorId: string,
	messageId: string,
	message: NodeMessage,
	signal?: AbortSignal,
) {
	// Find the leader node
	const [initialized, nodeId] = await redis.mget([
		KEYS.ACTOR.initialized(actorId),
		KEYS.ACTOR.LEASE.node(actorId),
	]);

	// Validate initialized
	if (!initialized) throw new AbortError("Actor not initialized");

	// Validate node
	if (!nodeId) {
		throw new Error("actor not leased, may be transferring leadership");
	}

	logger().debug("found actor leader node", { nodeId });

	// Create ack resolver
	const {
		promise: ackPromise,
		resolve: ackResolve,
		reject: ackReject,
	} = Promise.withResolvers<void>();
	globalState.messageAckResolvers.set(messageId, ackResolve);

	// Throw error on abort
	const signalListener = () => ackReject(new AbortError("Aborted"));
	signal?.addEventListener("abort", signalListener);

	// Throw error on timeout
	const ackTimeout =
		config.actorPeer?.messageAckTimeout ??
		DEFAULT_ACTOR_PEER_MESSAGE_ACK_TIMEOUT;
	const timeoutId = setTimeout(
		() => ackReject(new Error("Ack timed out")),
		ackTimeout,
	);

	try {
		// Forward outgoing message
		await redis.publish(PUBSUB.node(nodeId), JSON.stringify(message));

		logger().debug("waiting for message ack", { messageId });

		// Wait for ack
		await ackPromise;

		logger().debug("received message ack", { messageId });
	} finally {
		globalState.messageAckResolvers.delete(messageId);
		signal?.removeEventListener("abort", signalListener);
		clearTimeout(timeoutId);
	}
}
