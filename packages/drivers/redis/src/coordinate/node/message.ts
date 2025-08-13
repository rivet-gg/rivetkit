import type { RegistryConfig } from "@rivetkit/core";
import pRetry, { AbortError } from "p-retry";
import type { CoordinateDriverConfig } from "../config";
import type { CoordinateDriver } from "../driver";
import { logger } from "../log";
import type { GlobalState } from "../types";
import type { NodeMessage } from "./protocol";

/**
 * Publishes a message and waits for an ack. If no ack is received, then retries accordingly.
 *
 * This should be used any time a message to the leader is being published since it correctly handles leadership transfer edge cases.
 */
export async function publishMessageToLeader(
	registryConfig: RegistryConfig,
	driverConfig: CoordinateDriverConfig,
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
				driverConfig,
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

/**
 * Publishes a message to the leader without retrying on failure.
 *
 * This is specifically designed for WebSocket messages where retry doesn't make sense.
 * On leader change, it throws a LeaderChangedError that can be caught to close the WebSocket.
 */
export async function publishMessageToLeaderNoRetry(
	registryConfig: RegistryConfig,
	driverConfig: CoordinateDriverConfig,
	CoordinateDriver: CoordinateDriver,
	globalState: GlobalState,
	actorId: string,
	message: NodeMessage,
	signal?: AbortSignal,
): Promise<void> {
	// Include node
	message.n = globalState.nodeId;

	// Add message ID for ack
	const messageId = crypto.randomUUID();
	message.m = messageId;

	try {
		await publishMessageToLeaderInner(
			registryConfig,
			driverConfig,
			CoordinateDriver,
			globalState,
			actorId,
			messageId,
			message,
			signal,
		);
	} catch (error) {
		// Re-throw with more specific error types
		if (error instanceof Error) {
			if (error.message === "Actor not initialized") {
				throw new LeaderChangedError("Actor not found");
			} else if (
				error.message === "actor not leased, may be transferring leadership"
			) {
				throw new LeaderChangedError("Leader is changing");
			} else if (error.message === "Ack timed out") {
				throw new LeaderChangedError("Leader not responding");
			}
		}
		throw error;
	}
}

export class LeaderChangedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "LeaderChangedError";
	}
}

async function publishMessageToLeaderInner(
	registryConfig: RegistryConfig,
	driverConfig: CoordinateDriverConfig,
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
		driverConfig.actorPeer.messageAckTimeout,
	);

	try {
		// Forward outgoing message
		await CoordinateDriver.publishToNode(actor.leaderNodeId, message);

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
