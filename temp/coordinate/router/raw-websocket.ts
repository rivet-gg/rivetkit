import type { WebSocketOpts } from "@/actor/router-endpoints";
import type { Client } from "@/client/client";
import type { RegistryConfig } from "@/registry/config";
import type { Registry } from "@/registry/mod";
import type { RunConfig } from "@/registry/run-config";
import { ActorPeer } from "../actor-peer";
import { publishMessageToLeader } from "../node/message";
import type { GlobalState } from "../topology";

export async function handleRawWebSocket(
	registryConfig: RegistryConfig,
	runConfig: RunConfig,
	actorDriver: any,
	inlineClient: Client<Registry<any>>,
	CoordinateDriver: any,
	globalState: GlobalState,
	opts: WebSocketOpts,
): Promise<void> {
	// Create a relay for the raw WebSocket
	const websocketId = crypto.randomUUID();

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
			websocketId,
		);
	}

	// Serialize headers
	const headers: Record<string, string> = {};
	opts.request.headers.forEach((value, key) => {
		headers[key] = value;
	});

	// Open WebSocket on leader
	await publishMessageToLeader(
		registryConfig,
		runConfig,
		CoordinateDriver,
		globalState,
		opts.actorId,
		{
			b: {
				lwo: {
					ai: opts.actorId,
					wi: websocketId,
					url: new URL(opts.request.url).pathname,
					headers,
					ad: opts.authData,
				},
			},
		},
	);

	// Store WebSocket reference
	globalState.rawWebSockets.set(websocketId, opts.websocket);

	// Handle incoming messages from client
	opts.websocket.addEventListener("message", async (event: any) => {
		const isBinary = event.data instanceof ArrayBuffer;
		const data = isBinary
			? btoa(String.fromCharCode(...new Uint8Array(event.data)))
			: event.data;

		await publishMessageToLeader(
			registryConfig,
			runConfig,
			CoordinateDriver,
			globalState,
			opts.actorId,
			{
				b: {
					lwm: {
						wi: websocketId,
						data,
						binary: isBinary,
					},
				},
			},
		);
	});

	// Handle close
	opts.websocket.addEventListener("close", async (event: any) => {
		globalState.rawWebSockets.delete(websocketId);

		// Notify leader of close
		await publishMessageToLeader(
			registryConfig,
			runConfig,
			CoordinateDriver,
			globalState,
			opts.actorId,
			{
				b: {
					lwc: {
						wi: websocketId,
						code: event.code,
						reason: event.reason,
					},
				},
			},
		);
	});

	// Handle error
	opts.websocket.addEventListener("error", async (_event: any) => {
		globalState.rawWebSockets.delete(websocketId);

		// Notify leader of close due to error
		await publishMessageToLeader(
			registryConfig,
			runConfig,
			CoordinateDriver,
			globalState,
			opts.actorId,
			{
				b: {
					lwc: {
						wi: websocketId,
						code: 1006, // Abnormal closure
						reason: "WebSocket error",
					},
				},
			},
		);
	});
}
