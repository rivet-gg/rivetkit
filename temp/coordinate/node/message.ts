import pRetry, { AbortError } from "p-retry";
import type { RegistryConfig } from "@/registry/config";
import type { RunConfig } from "@/registry/run-config";
import type { GlobalState } from "@/topologies/coordinate/topology";
import type { CoordinateDriver } from "../driver";
import { logger } from "../log";
import type { NodeMessage } from "./protocol";

/**
 * Publishes a message and waits for an ack. If no ack is received, then retries accordingly.
 *
 * This should be used any time a message to the leader is being published since it correctly handles leadership transfer edge cases.
 */
export async function publishMessageToLeader(
	registryConfig: RegistryConfig,
	runConfig: RunConfig,
	CoordinateDriver: CoordinateDriver,
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
				registryConfig,
				runConfig,
				CoordinateDriver,
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
	registryConfig: RegistryConfig,
	runConfig: RunConfig,
	CoordinateDriver: CoordinateDriver,
	globalState: GlobalState,
	actorId: string,
	messageId: string,
	message: NodeMessage,
	signal?: AbortSignal,
) {
	// Find the leader node
	const { actor } = await CoordinateDriver.getActorLeader(actorId);

	// Validate initialized
	if (!actor) throw new AbortError("Actor not initialized");

	// Validate node
	if (!actor.leaderNodeId) {
		throw new Error("actor not leased, may be transferring leadership");
	}

	logger().debug("found actor leader node", { nodeId: actor.leaderNodeId });

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
	const timeoutId = setTimeout(
		() => ackReject(new Error("Ack timed out")),
		runConfig.actorPeer.messageAckTimeout,
	);

	try {
		// Forward outgoing message
		await CoordinateDriver.publishToNode(
			actor.leaderNodeId,
			JSON.stringify(message),
		);

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
