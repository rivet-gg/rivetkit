import type { ActorRouter } from "@rivetkit/core";
import { ActorPeer } from "../../actor-peer";
import type { CoordinateDriver } from "../../driver";
import { logger } from "../../log";
import type { GlobalState } from "../../types";
import type {
	NodeMessage,
	ToFollowerFetchResponse,
	ToLeaderFetch,
} from "../protocol";

export async function handleLeaderFetch(
	globalState: GlobalState,
	coordinateDriver: CoordinateDriver,
	actorRouter: ActorRouter,
	nodeId: string | undefined,
	fetch: ToLeaderFetch,
) {
	if (!nodeId) {
		logger().error("node id not provided for leader fetch");
		return;
	}

	try {
		const actor = await ActorPeer.getLeaderActor(globalState, fetch.ai);
		if (!actor) {
			const errorMessage: NodeMessage = {
				b: {
					ffr: {
						ri: fetch.ri,
						status: 404,
						headers: {},
						error: "Actor not found",
					},
				},
			};
			await coordinateDriver.publishToNode(nodeId, errorMessage);
			return;
		}

		// Reconstruct request
		const url = new URL(`http://actor${fetch.url}`);
		const body = fetch.body
			? fetch.body instanceof Uint8Array
				? fetch.body
				: new TextEncoder().encode(fetch.body)
			: undefined;

		const request = new Request(url, {
			method: fetch.method,
			headers: fetch.headers,
			body,
		});

		// Call actor's handleFetch
		const response = await actorRouter.fetch(request, {
			actorId: actor.id,
		});

		// handleFetch should always return a Response (it throws if not), but TypeScript doesn't know that
		if (!response) {
			throw new Error("handleFetch returned void unexpectedly");
		}

		// Serialize response
		const responseHeaders: Record<string, string> = {};
		response.headers.forEach((value: string, key: string) => {
			// Skip headers that will be automatically managed by the Response constructor
			const lowerKey = key.toLowerCase();
			if (lowerKey !== "content-length" && lowerKey !== "transfer-encoding") {
				responseHeaders[key] = value;
			}
		});

		let responseBody: string | Uint8Array | undefined;
		if (response.body) {
			const buffer = await response.arrayBuffer();
			responseBody = new Uint8Array(buffer);
		}

		// Send response back
		const responseMessage: NodeMessage = {
			b: {
				ffr: {
					ri: fetch.ri,
					status: response.status,
					headers: responseHeaders,
					body: responseBody,
				},
			},
		};
		await coordinateDriver.publishToNode(nodeId, responseMessage);
	} catch (error) {
		const errorMessage: NodeMessage = {
			b: {
				ffr: {
					ri: fetch.ri,
					status: 500,
					headers: {},
					error:
						error instanceof Error ? error.message : "Internal server error",
				},
			},
		};
		await coordinateDriver.publishToNode(nodeId, errorMessage);
	}
}

export function handleFollowerFetchResponse(
	globalState: GlobalState,
	response: ToFollowerFetchResponse,
) {
	const resolver = globalState.fetchResponseResolvers.get(response.ri);
	if (resolver) {
		resolver(response);
	}
}
