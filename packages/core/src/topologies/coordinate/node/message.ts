import type { GlobalState } from "@/topologies/coordinate/topology";
import { logger } from "../log";
import pRetry, { AbortError } from "p-retry";
import type { CoordinateDriver } from "../driver";
import type { NodeMessage } from "./protocol";
import { DriverConfig } from "@/driver-helpers/config";
import { RegistryConfig } from "@/registry/config";

/**
 * Publishes a message and waits for an ack. If no ack is received, then retries accordingly.
 *
 * This should be used any time a message to the leader is being published since it correctly handles leadership transfer edge cases.
 */
export async function publishMessageToLeader(
	registryConfig: RegistryConfig,
	driverConfig: DriverConfig,
	CoordinateDriver: CoordinateDriver,
	globalState: GlobalState,
	workerId: string,
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
				workerId,
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
	driverConfig: DriverConfig,
	CoordinateDriver: CoordinateDriver,
	globalState: GlobalState,
	workerId: string,
	messageId: string,
	message: NodeMessage,
	signal?: AbortSignal,
) {
	// Find the leader node
	const { worker } = await CoordinateDriver.getWorkerLeader(workerId);

	// Validate initialized
	if (!worker) throw new AbortError("Worker not initialized");

	// Validate node
	if (!worker.leaderNodeId) {
		throw new Error("worker not leased, may be transferring leadership");
	}

	logger().debug("found worker leader node", { nodeId: worker.leaderNodeId });

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
		registryConfig.workerPeer.messageAckTimeout,
	);

	try {
		// Forward outgoing message
		await CoordinateDriver.publishToNode(
			worker.leaderNodeId,
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
