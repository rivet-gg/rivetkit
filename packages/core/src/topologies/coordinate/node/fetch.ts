import * as errors from "@/actor/errors";
import type { FetchOpts } from "@/actor/router-endpoints";
import type { Client } from "@/client/client";
import type { RegistryConfig } from "@/registry/config";
import type { Registry } from "@/registry/mod";
import type { RunConfig } from "@/registry/run-config";
import { ActorPeer } from "../actor-peer";
import type { GlobalState } from "../topology";
import { publishMessageToLeader } from "./message";
import type { ToFollowerFetchResponse } from "./protocol";

export async function publishFetchToLeader(
	registryConfig: RegistryConfig,
	runConfig: RunConfig,
	CoordinateDriver: any,
	actorDriver: any,
	inlineClient: Client<Registry<any>>,
	globalState: GlobalState,
	opts: FetchOpts,
): Promise<Response> {
	// Ensure actor peer exists
	let actorPeer = globalState.actorPeers.get(opts.actorId);
	if (!actorPeer) {
		actorPeer = await ActorPeer.acquire(
			registryConfig,
			runConfig,
			actorDriver,
			inlineClient,
			CoordinateDriver,
			globalState,
			opts.actorId,
			crypto.randomUUID(),
		);
	}

	const requestId = crypto.randomUUID();

	// Create promise for response
	const {
		promise: responsePromise,
		resolve: responseResolve,
		reject: responseReject,
	} = Promise.withResolvers<ToFollowerFetchResponse>();

	globalState.fetchResponseResolvers.set(requestId, responseResolve);

	const timeoutId = setTimeout(() => {
		globalState.fetchResponseResolvers.delete(requestId);
		responseReject(new errors.InternalError("Fetch request timed out"));
	}, 30000); // 30 second timeout for HTTP requests

	try {
		// Serialize request
		const headers: Record<string, string> = {};
		opts.request.headers.forEach((value, key) => {
			headers[key] = value;
		});

		let body: string | undefined;
		if (opts.request.body) {
			const buffer = await opts.request.arrayBuffer();
			body = btoa(String.fromCharCode(...new Uint8Array(buffer)));
		}

		// Send fetch request to leader
		await publishMessageToLeader(
			registryConfig,
			runConfig,
			CoordinateDriver,
			globalState,
			opts.actorId,
			{
				b: {
					lf: {
						ri: requestId,
						ai: opts.actorId,
						method: opts.request.method,
						url: new URL(opts.request.url).pathname,
						headers,
						body,
						ad: opts.authData,
					},
				},
			},
			opts.request.signal,
		);

		// Wait for response
		const result = await responsePromise;

		if (result.error) {
			throw new errors.InternalError(result.error);
		}

		// Reconstruct response
		const responseBody = result.body
			? new Uint8Array(
					atob(result.body)
						.split("")
						.map((c) => c.charCodeAt(0)),
				)
			: undefined;

		return new Response(responseBody, {
			status: result.status,
			headers: result.headers,
		});
	} finally {
		globalState.fetchResponseResolvers.delete(requestId);
		clearTimeout(timeoutId);
	}
}
