import type { ActorDriver } from "@/actor/driver";
import * as errors from "@/actor/errors";
import type { ActionOpts, ActionOutput } from "@/actor/router-endpoints";
import type { Client } from "@/client/client";
import type { RegistryConfig } from "@/registry/config";
import type { Registry } from "@/registry/mod";
import type { RunConfig } from "@/registry/run-config";
import { ActorPeer } from "../actor-peer";
import type { CoordinateDriver } from "../driver";
import type { GlobalState } from "../topology";
import { publishMessageToLeader } from "./message";

/**
 * Publishes an action to the leader and waits for the response.
 */
export async function publishActionToLeader(
	registryConfig: RegistryConfig,
	runConfig: RunConfig,
	CoordinateDriver: CoordinateDriver,
	actorDriver: ActorDriver,
	inlineClient: Client<Registry<any>>,
	globalState: GlobalState,
	opts: ActionOpts,
): Promise<ActionOutput> {
	// Ensure actor peer exists for this actor
	// In coordinate topology, actors are created on-demand when first accessed
	let actorPeer = globalState.actorPeers.get(opts.actorId);
	if (!actorPeer) {
		try {
			actorPeer = await ActorPeer.acquire(
				registryConfig,
				runConfig,
				actorDriver,
				inlineClient,
				CoordinateDriver,
				globalState,
				opts.actorId,
				crypto.randomUUID(), // temporary connection ID
			);
		} catch (error) {
			// If actor peer creation fails due to missing persisted data,
			// it means the actor doesn't exist yet. In coordinate topology,
			// this should be handled by creating the actor through the manager first.
			throw new errors.InternalError(`Failed to create actor peer: ${error}`);
		}
	}
	// Generate request ID for this action
	const requestId = crypto.randomUUID();

	// Create promise resolver for the response
	const {
		promise: responsePromise,
		resolve: responseResolve,
		reject: responseReject,
	} = Promise.withResolvers<{
		success: boolean;
		output?: unknown;
		error?: string;
	}>();

	globalState.actionResponseResolvers.set(requestId, responseResolve);

	// Set up timeout - use a longer timeout for coordinate topology since
	// publishMessageToLeader has its own retry logic that can take several seconds
	const timeoutId = setTimeout(() => {
		globalState.actionResponseResolvers.delete(requestId);
		responseReject(new errors.InternalError("Action request timed out"));
	}, runConfig.actorPeer.messageAckTimeout * 10); // 10 seconds instead of 1 second

	try {
		// Send action to leader using publishMessageToLeader
		await publishMessageToLeader(
			registryConfig,
			runConfig,
			CoordinateDriver,
			globalState,
			opts.actorId,
			{
				b: {
					la: {
						ri: requestId,
						ai: opts.actorId,
						an: opts.actionName,
						aa: opts.actionArgs,
						p: opts.params,
						ad: opts.authData,
					},
				},
			},
			opts.req?.raw.signal,
		);

		// Wait for response
		const result = await responsePromise;

		if (result.success) {
			return { output: result.output };
		} else {
			throw new errors.InternalError(result.error || "Action execution failed");
		}
	} finally {
		globalState.actionResponseResolvers.delete(requestId);
		clearTimeout(timeoutId);
	}
}
