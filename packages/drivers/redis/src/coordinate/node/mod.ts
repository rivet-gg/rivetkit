import {
	ActionContext,
	type ActorRouter,
	type AnyClient,
	createActorRouter,
	createClientWithDriver,
	createInlineClientDriver,
	type Encoding,
	generateConnId,
	generateConnToken,
	handleRawWebSocketHandler,
	handleWebSocketConnect,
	InlineWebSocketAdapter2,
	noopNext,
	PATH_CONNECT_WEBSOCKET,
	PATH_RAW_WEBSOCKET_PREFIX,
	type RegistryConfig,
	RivetCloseEvent,
	type RunConfig,
	UniversalWebSocket,
} from "@rivetkit/core";
import type { ActorDriver, ManagerDriver } from "@rivetkit/core/driver-helpers";
import { assertUnreachable } from "@rivetkit/core/utils";
import * as cbor from "cbor-x";
import type { Context as HonoContext } from "hono";
import invariant from "invariant";
import { ActorPeer } from "../actor-peer";
import type { CoordinateDriverConfig } from "../config";
import type { CoordinateDriver } from "../driver";
import { logger } from "../log";
import { RelayConn } from "../relay-conn";
import type { GlobalState } from "../types";
import {
	LeaderChangedError,
	publishMessageToLeader,
	publishMessageToLeaderNoRetry,
} from "./message";
import {
	handleFollowerFetchResponse,
	handleLeaderFetch,
} from "./message-handlers/fetch";
import {
	handleFollowerWebSocketClose,
	handleFollowerWebSocketMessage,
	handleFollowerWebSocketOpen,
} from "./message-handlers/websocket-follower";
import {
	handleLeaderWebSocketClose,
	handleLeaderWebSocketMessage,
	handleLeaderWebSocketOpen,
} from "./message-handlers/websocket-leader";
import {
	type Ack,
	type NodeMessage,
	NodeMessageSchema,
	type ToFollowerFetchResponse,
} from "./protocol";
import { proxyWebSocket as proxyWebSocketImpl } from "./proxy-websocket";
import { RelayWebSocketAdapter } from "./relay-websocket-adapter";

export class Node {
	#registryConfig: RegistryConfig;
	#runConfig: RunConfig;
	#driverConfig: CoordinateDriverConfig;
	#coordinateDriver: CoordinateDriver;
	#globalState: GlobalState;
	#inlineClient: AnyClient;
	#actorDriver: ActorDriver;
	#actorRouter: ActorRouter;

	get inlineClient() {
		return this.#inlineClient;
	}
	get actorDriver() {
		return this.#actorDriver;
	}

	constructor(
		registryConfig: RegistryConfig,
		runConfig: RunConfig,
		driverConfig: CoordinateDriverConfig,
		managerDriver: ManagerDriver,
		coordinateDriver: CoordinateDriver,
		globalState: GlobalState,
		inlineClient: AnyClient,
		actorDriver: ActorDriver,
		actorRouter: ActorRouter,
	) {
		this.#registryConfig = registryConfig;
		this.#runConfig = runConfig;
		this.#driverConfig = driverConfig;
		this.#coordinateDriver = coordinateDriver;
		this.#globalState = globalState;
		this.#inlineClient = inlineClient;
		this.#actorDriver = actorDriver;
		this.#actorRouter = actorRouter;
	}

	get globalState(): GlobalState {
		return this.#globalState;
	}

	get coordinateDriver(): CoordinateDriver {
		return this.#coordinateDriver;
	}

	get registryConfig(): RegistryConfig {
		return this.#registryConfig;
	}

	get runConfig(): RunConfig {
		return this.#runConfig;
	}

	get driverConfig(): CoordinateDriverConfig {
		return this.#driverConfig;
	}

	async start() {
		logger().debug("starting", { nodeId: this.#globalState.nodeId });

		// Subscribe to events
		//
		// We intentionally design this so there's only one topic for the subscriber to listen on in order to reduce chattiness to the pubsub server.
		//
		// If we had a dedicated topic for each actor, we'd have to create a SUB for each leader & follower for each actor which is much more expensive than one for each node.
		//
		// Additionally, in most serverless environments, 1 node usually owns 1 actor, so this would double the RTT to create the required subscribers.
		await this.#coordinateDriver.createNodeSubscriber(
			this.#globalState.nodeId,
			this.#onMessage.bind(this),
		);

		logger().debug("node started", { nodeId: this.#globalState.nodeId });
	}

	async #onMessage(data: NodeMessage) {
		const shouldAck = !!(data.n && data.m);
		logger().debug("node received message", { data, shouldAck });

		// Ack message
		if (shouldAck) {
			invariant(data.n && data.m, "unreachable");

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
			this.#coordinateDriver.publishToNode(data.n, messageRaw);
		}

		// Handle message
		if ("a" in data.b) {
			await this.#onAck(data.b.a);
		} else if ("lf" in data.b) {
			await handleLeaderFetch(
				this.#globalState,
				this.#coordinateDriver,
				this.#actorRouter,
				data.n,
				data.b.lf,
			);
		} else if ("ffr" in data.b) {
			handleFollowerFetchResponse(this.#globalState, data.b.ffr);
		} else if ("lwo" in data.b) {
			logger().debug("received lwo (leader websocket open) message", {
				websocketId: data.b.lwo.wi,
				actorId: data.b.lwo.ai,
				fromNodeId: data.n,
			});
			await handleLeaderWebSocketOpen(
				this.#globalState,
				this.#coordinateDriver,
				this.#runConfig,
				this.#actorDriver,
				data.n,
				data.b.lwo,
			);
		} else if ("lwm" in data.b) {
			await handleLeaderWebSocketMessage(this.#globalState, data.b.lwm);
		} else if ("lwc" in data.b) {
			await handleLeaderWebSocketClose(this.#globalState, data.b.lwc);
		} else if ("fwo" in data.b) {
			logger().debug("received fwo (follower websocket open) message", {
				websocketId: data.b.fwo.wi,
			});
			await handleFollowerWebSocketOpen(this.#globalState, data.b.fwo);
		} else if ("fwm" in data.b) {
			await handleFollowerWebSocketMessage(this.#globalState, data.b.fwm);
		} else if ("fwc" in data.b) {
			await handleFollowerWebSocketClose(this.#globalState, data.b.fwc);
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

	async sendRequest(
		actorId: string,
		actorRequest: Request,
		abortController?: AbortController,
	): Promise<Response> {
		// Generate request ID
		const requestId = crypto.randomUUID();

		// Extract request details
		const url = new URL(actorRequest.url);
		const headers: Record<string, string> = {};
		actorRequest.headers.forEach((value, key) => {
			headers[key] = value;
		});

		let body: Uint8Array | undefined;
		if (actorRequest.body) {
			const buffer = await actorRequest.arrayBuffer();
			body = new Uint8Array(buffer);
		}

		// Create promise to wait for response
		const responsePromise = new Promise<ToFollowerFetchResponse>((resolve) => {
			this.#globalState.fetchResponseResolvers.set(requestId, resolve);
		});

		// Open connection
		const relayConn = new RelayConn(
			this.#registryConfig,
			this.#runConfig,
			this.#driverConfig,
			this.#actorDriver,
			this.#inlineClient,
			this.#coordinateDriver,
			this.#globalState,
			{
				disconnect: async (_reason: any) => {
					// TODO: Abort request client-side
				},
			},
			actorId,
		);
		await relayConn.start();

		// Publish request
		try {
			const message: NodeMessage = {
				b: {
					lf: {
						ri: requestId,
						ai: actorId,
						method: actorRequest.method,
						url: url.pathname + url.search,
						headers,
						body,
						// TODO: Auth data
						ad: undefined,
					},
				},
			};
			await relayConn.publishMessageToleader(message, true);
		} catch (error) {
			this.#globalState.fetchResponseResolvers.delete(requestId);
			if (error instanceof Error) {
				return new Response(error.message, { status: 503 });
			}
			return new Response(
				"Service unavailable (cannot send message to actor leader)",
				{ status: 503 },
			);
		}

		// Wait for response with timeout (publishMessageToLeader already handles leader retries)
		const response = await responsePromise.finally(() => {
			this.#globalState.fetchResponseResolvers.delete(requestId);
		});

		// Handle error response
		if (response.error) {
			return new Response(response.error, {
				status: response.status,
				headers: response.headers,
			});
		}

		// Reconstruct response
		const responseBody = response.body;

		return new Response(responseBody, {
			status: response.status,
			headers: response.headers,
		});
	}

	// TODO: Clean up disconnecting logic for websocket. There might be missed edge conditions depending on if client or server terminates the websocket
	async openWebSocket(
		path: string,
		actorId: string,
		encoding: Encoding,
		connParams: unknown,
	): Promise<WebSocket> {
		// Create WebSocket ID
		const websocketId = crypto.randomUUID();

		logger().debug("opening websocket for inline client", {
			websocketId,
			actorId,
			path,
			encoding,
			nodeId: this.#globalState.nodeId,
		});

		// Open connection
		const relayConn = new RelayConn(
			this.#registryConfig,
			this.#runConfig,
			this.#driverConfig,
			this.#actorDriver,
			this.#inlineClient,
			this.#coordinateDriver,
			this.#globalState,
			{
				disconnect: async (_reason: any) => {
					// TODO: Abort request client-side
				},
			},
			actorId,
		);
		await relayConn.start();

		// Create a WebSocket adapter that relays messages BEFORE sending the open message
		// This ensures the adapter is registered when the open confirmation arrives
		const adapter = new RelayWebSocketAdapter(this, websocketId, relayConn);
		this.#globalState.relayWebSockets.set(websocketId, adapter);

		// Open WebSocket
		const openMessage: NodeMessage = {
			b: {
				lwo: {
					ai: actorId,
					wi: websocketId,
					url: path,
					e: encoding,
					cp: connParams,
					ad: undefined,
				},
			},
		};
		await relayConn.publishMessageToleader(openMessage, true);

		logger().debug("websocket adapter created, waiting for open", {
			websocketId,
		});

		// Wait for the WebSocket to be open before returning
		logger().debug("waiting for websocket adapter open promise", {
			websocketId,
			actorId,
			path,
			encoding,
			adapterReadyState: adapter.readyState,
		});
		await adapter.openPromise;
		logger().debug("websocket adapter open promise resolved", {
			websocketId,
			actorId,
			adapterReadyState: adapter.readyState,
		});

		logger().debug("websocket adapter ready", { websocketId });

		return adapter;
	}

	// TODO: Implement abort controller
	async proxyRequest(
		c: HonoContext,
		actorRequest: Request,
		actorId: string,
	): Promise<Response> {
		return await this.sendRequest(actorId, actorRequest);
	}

	async proxyWebSocket(
		c: HonoContext,
		path: string,
		actorId: string,
		encoding: Encoding,
		connParams: unknown,
		authData: unknown,
	): Promise<Response> {
		return proxyWebSocketImpl(
			this,

			c,
			path,
			actorId,
			encoding,
			connParams,
			authData,
		);
	}
}
