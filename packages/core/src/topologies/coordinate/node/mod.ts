import { ActionContext } from "@/actor/action";
import { assertUnreachable } from "@/common/utils";
import type {
	RivetCloseEvent,
	UniversalWebSocket,
} from "@/common/websocket-interface";
import {
	CONN_DRIVER_GENERIC_HTTP,
	type GenericHttpDriverState,
} from "@/topologies/common/generic-conn-driver";
import { ActorPeer } from "../actor-peer";
import {
	CONN_DRIVER_COORDINATE_RELAY,
	type CoordinateRelayState,
} from "../conn/driver";
import type { CoordinateDriver } from "../driver";
import { logger } from "../log";
import type { GlobalState } from "../topology";
import {
	type Ack,
	type NodeMessage,
	NodeMessageSchema,
	type ToFollowerActionResponse,
	type ToFollowerConnectionClose,
	type ToFollowerFetchResponse,
	type ToFollowerMessage,
	type ToFollowerWebSocketClose,
	type ToFollowerWebSocketMessage,
	type ToLeaderAction,
	type ToLeaderConnectionClose,
	type ToLeaderConnectionOpen,
	type ToLeaderFetch,
	type ToLeaderMessage,
	type ToLeaderWebSocketClose,
	type ToLeaderWebSocketMessage,
	type ToLeaderWebSocketOpen,
} from "./protocol";

export class Node {
	#CoordinateDriver: CoordinateDriver;
	#globalState: GlobalState;

	constructor(CoordinateDriver: CoordinateDriver, globalState: GlobalState) {
		this.#CoordinateDriver = CoordinateDriver;
		this.#globalState = globalState;
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
		await this.#CoordinateDriver.createNodeSubscriber(
			this.#globalState.nodeId,
			this.#onMessage.bind(this),
		);

		logger().debug("node started", { nodeId: this.#globalState.nodeId });
	}

	async #onMessage(message: string) {
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
			this.#CoordinateDriver.publishToNode(data.n, JSON.stringify(messageRaw));
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
		} else if ("la" in data.b) {
			await this.#onLeaderAction(data.n, data.b.la);
		} else if ("fcc" in data.b) {
			await this.#onFollowerConnectionClose(data.b.fcc);
		} else if ("fm" in data.b) {
			await this.#onFollowerMessage(data.b.fm);
		} else if ("far" in data.b) {
			await this.#onFollowerActionResponse(data.b.far);
		} else if ("lf" in data.b) {
			await this.#onLeaderFetch(data.n, data.b.lf);
		} else if ("ffr" in data.b) {
			await this.#onFollowerFetchResponse(data.b.ffr);
		} else if ("lwo" in data.b) {
			await this.#onLeaderWebSocketOpen(data.n, data.b.lwo);
		} else if ("lwm" in data.b) {
			await this.#onLeaderWebSocketMessage(data.b.lwm);
		} else if ("lwc" in data.b) {
			await this.#onLeaderWebSocketClose(data.b.lwc);
		} else if ("fwm" in data.b) {
			await this.#onFollowerWebSocketMessage(data.b.fwm);
		} else if ("fwc" in data.b) {
			await this.#onFollowerWebSocketClose(data.b.fwc);
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
			ad: authData,
		}: ToLeaderConnectionOpen,
	) {
		if (!nodeId) {
			logger().error("node id not provided for leader connection open event");
			return;
		}

		logger().debug("received connection open", { actorId, connId });

		// Connection open

		try {
			const actor = ActorPeer.getLeaderActor(this.#globalState, actorId);
			if (!actor) {
				logger().warn("received message for nonexistent actor leader", {
					actorId,
				});
				return;
			}

			const connState = await actor.prepareConn(connParams);
			await actor.createConn(
				connId,
				connToken,
				connParams,
				connState,
				CONN_DRIVER_COORDINATE_RELAY,
				{ nodeId } satisfies CoordinateRelayState,
				authData,
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

		const conn = actor.__getConnForId(connId);
		if (conn) {
			actor.__removeConn(conn);
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
		const conn = actor.__getConnForId(connId);
		if (conn) {
			// Validate token
			if (conn._token !== connToken) {
				throw new Error("connection token does not match");
			}

			// Process message
			await actor.processMessage(message, conn);
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
		const conn = this.#globalState.relayConns.get(connId);
		if (!conn) {
			logger().warn("missing connection", { connId });
			return;
		}

		conn.disconnect(true, reason);
	}

	async #onFollowerMessage({ ci: connId, m: message }: ToFollowerMessage) {
		const conn = this.#globalState.relayConns.get(connId);
		if (!conn) {
			logger().warn("missing connection", { connId });
			return;
		}

		conn.onMessage(message);
	}

	async #onLeaderAction(
		nodeId: string | undefined,
		{
			ri: requestId,
			ai: actorId,
			an: actionName,
			aa: actionArgs,
			p: params,
			ad: authData,
		}: ToLeaderAction,
	) {
		if (!nodeId) {
			logger().error("node id not provided for leader action");
			return;
		}

		logger().debug("received action request", {
			actorId,
			actionName,
			requestId,
		});

		try {
			const actor = ActorPeer.getLeaderActor(this.#globalState, actorId);
			if (!actor) {
				logger().warn("received action for nonexistent actor leader", {
					actorId,
				});

				// Send error response
				const errorMessage: NodeMessage = {
					b: {
						far: {
							ri: requestId,
							s: false,
							e: "Actor not found",
						},
					},
				};
				await this.#CoordinateDriver.publishToNode(
					nodeId,
					JSON.stringify(errorMessage),
				);
				return;
			}

			// Ensure the actor is ready before proceeding
			if (!actor.isReady()) {
				// Send error response
				const errorMessage: NodeMessage = {
					b: {
						far: {
							ri: requestId,
							s: false,
							e: "Actor not ready",
						},
					},
				};
				await this.#CoordinateDriver.publishToNode(
					nodeId,
					JSON.stringify(errorMessage),
				);
				return;
			}

			// Create temporary connection for the action (similar to other topologies)
			const connState = await actor.prepareConn(params);
			const conn = await actor.createConn(
				crypto.randomUUID(), // temporary conn ID
				crypto.randomUUID(), // temporary conn token
				params,
				connState,
				CONN_DRIVER_GENERIC_HTTP,
				{} satisfies GenericHttpDriverState,
				authData,
			);

			try {
				// Execute the action
				const ctx = new ActionContext(actor.actorContext!, conn);
				const output = await actor.executeAction(ctx, actionName, actionArgs);

				// Send success response
				const successMessage: NodeMessage = {
					b: {
						far: {
							ri: requestId,
							s: true,
							o: output,
						},
					},
				};
				await this.#CoordinateDriver.publishToNode(
					nodeId,
					JSON.stringify(successMessage),
				);
			} finally {
				// Clean up temporary connection
				actor.__removeConn(conn);
			}
		} catch (error) {
			logger().warn("failed to execute action", { error: `${error}` });

			// Send error response
			const errorMessage: NodeMessage = {
				b: {
					far: {
						ri: requestId,
						s: false,
						e: error instanceof Error ? error.message : "Unknown error",
					},
				},
			};
			await this.#CoordinateDriver.publishToNode(
				nodeId,
				JSON.stringify(errorMessage),
			);
		}
	}

	async #onFollowerActionResponse({
		ri: requestId,
		s: success,
		o: output,
		e: error,
	}: ToFollowerActionResponse) {
		logger().debug("received action response", { requestId, success });

		const resolver = this.#globalState.actionResponseResolvers.get(requestId);
		if (resolver) {
			resolver({ success, output, error });
			this.#globalState.actionResponseResolvers.delete(requestId);
		} else {
			logger().warn("missing action response resolver", { requestId });
		}
	}

	async #onLeaderFetch(nodeId: string | undefined, fetch: ToLeaderFetch) {
		if (!nodeId) {
			logger().error("node id not provided for leader fetch");
			return;
		}

		try {
			const actor = ActorPeer.getLeaderActor(this.#globalState, fetch.ai);
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
				await this.#CoordinateDriver.publishToNode(
					nodeId,
					JSON.stringify(errorMessage),
				);
				return;
			}

			// Reconstruct request
			const url = new URL(`http://actor${fetch.url}`);
			const body = fetch.body
				? new Uint8Array(
						atob(fetch.body)
							.split("")
							.map((c) => c.charCodeAt(0)),
					)
				: undefined;

			const request = new Request(url, {
				method: fetch.method,
				headers: fetch.headers,
				body,
			});

			// Call actor's handleFetch
			const response = await actor.handleFetch(request);

			// handleFetch should always return a Response (it throws if not), but TypeScript doesn't know that
			if (!response) {
				throw new Error("handleFetch returned void unexpectedly");
			}

			// Serialize response
			const responseHeaders: Record<string, string> = {};
			response.headers.forEach((value: string, key: string) => {
				responseHeaders[key] = value;
			});

			let responseBody: string | undefined;
			if (response.body) {
				const buffer = await response.arrayBuffer();
				responseBody = btoa(String.fromCharCode(...new Uint8Array(buffer)));
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
			await this.#CoordinateDriver.publishToNode(
				nodeId,
				JSON.stringify(responseMessage),
			);
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
			await this.#CoordinateDriver.publishToNode(
				nodeId,
				JSON.stringify(errorMessage),
			);
		}
	}

	async #onFollowerFetchResponse(response: ToFollowerFetchResponse) {
		const resolver = this.#globalState.fetchResponseResolvers.get(response.ri);
		if (resolver) {
			resolver(response);
		}
	}

	async #onLeaderWebSocketOpen(
		nodeId: string | undefined,
		open: ToLeaderWebSocketOpen,
	) {
		if (!nodeId) {
			logger().error("node id not provided for leader websocket open");
			return;
		}

		try {
			const actor = ActorPeer.getLeaderActor(this.#globalState, open.ai);
			if (!actor) {
				logger().warn("received websocket open for nonexistent actor leader", {
					actorId: open.ai,
				});
				return;
			}

			// Reconstruct request
			const url = new URL(`ws://actor${open.url}`);
			const request = new Request(url, {
				headers: open.headers,
			});

			// Create WebSocket bridge that will forward messages back to follower
			const bridge: UniversalWebSocket = {
				// WebSocket state constants
				CONNECTING: 0 as const,
				OPEN: 1 as const,
				CLOSING: 2 as const,
				CLOSED: 3 as const,

				// Properties
				readyState: 1 as const, // OPEN
				binaryType: "arraybuffer" as const,
				bufferedAmount: 0,
				extensions: "",
				protocol: "",
				url: request.url,

				// Event handlers
				onopen: null,
				onclose: null,
				onerror: null,
				onmessage: null,

				// Methods
				send: (
					data: string | ArrayBufferLike | Blob | ArrayBufferView,
				): void => {
					// Convert data to ArrayBuffer or string
					let processedData: string | ArrayBuffer;
					if (typeof data === "string") {
						processedData = data;
					} else if (data instanceof ArrayBuffer) {
						processedData = data;
					} else if (data instanceof Blob) {
						// For now, we'll throw on Blob since we need to handle it async
						throw new Error("Blob data not supported in coordinate topology");
					} else if (ArrayBuffer.isView(data)) {
						// Handle ArrayBufferView (including TypedArrays and DataView)
						if (data.buffer instanceof SharedArrayBuffer) {
							// Convert from SharedArrayBuffer
							const buffer = new ArrayBuffer(data.byteLength);
							new Uint8Array(buffer).set(
								new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
							);
							processedData = buffer;
						} else {
							processedData = data.buffer.slice(
								data.byteOffset,
								data.byteOffset + data.byteLength,
							);
						}
					} else if (data instanceof SharedArrayBuffer) {
						// Convert SharedArrayBuffer to ArrayBuffer
						const buffer = new ArrayBuffer(data.byteLength);
						new Uint8Array(buffer).set(new Uint8Array(data));
						processedData = buffer;
					} else {
						// Assume it's ArrayBuffer-like
						const buffer = new ArrayBuffer((data as ArrayBuffer).byteLength);
						new Uint8Array(buffer).set(new Uint8Array(data as ArrayBuffer));
						processedData = buffer;
					}

					const isBinary = processedData instanceof ArrayBuffer;
					const encodedData = isBinary
						? btoa(
								String.fromCharCode(
									...new Uint8Array(processedData as ArrayBuffer),
								),
							)
						: (processedData as string);

					const message: NodeMessage = {
						b: {
							fwm: {
								wi: open.wi,
								data: encodedData,
								binary: isBinary,
							},
						},
					};
					this.#CoordinateDriver.publishToNode(nodeId, JSON.stringify(message));
				},
				close: (code?: number, reason?: string): void => {
					const message: NodeMessage = {
						b: {
							fwc: {
								wi: open.wi,
								code,
								reason,
							},
						},
					};
					this.#CoordinateDriver.publishToNode(nodeId, JSON.stringify(message));
				},
				addEventListener(): void {
					// For now, we only support the on* event handlers
				},
				removeEventListener(): void {
					// For now, we only support the on* event handlers
				},
				dispatchEvent(): boolean {
					return true;
				},
			};

			// Store WebSocket handler reference
			const wsHandler = { bridge, actorId: open.ai };
			(this.#globalState as any).leaderWebSockets =
				(this.#globalState as any).leaderWebSockets || new Map();
			(this.#globalState as any).leaderWebSockets.set(open.wi, wsHandler);

			// Call actor's handleWebSocket
			await actor.handleWebSocket(bridge as any, request);
		} catch (error) {
			logger().warn("failed to open websocket", { error: `${error}` });

			// Send close message
			const message: NodeMessage = {
				b: {
					fwc: {
						wi: open.wi,
						code: 1011, // Internal error
						reason:
							error instanceof Error ? error.message : "Internal server error",
					},
				},
			};
			await this.#CoordinateDriver.publishToNode(
				nodeId,
				JSON.stringify(message),
			);
		}
	}

	async #onLeaderWebSocketMessage(message: ToLeaderWebSocketMessage) {
		const wsHandler = (this.#globalState as any).leaderWebSockets?.get(
			message.wi,
		);
		if (!wsHandler) {
			logger().warn("received websocket message for nonexistent websocket", {
				websocketId: message.wi,
			});
			return;
		}

		const actor = ActorPeer.getLeaderActor(
			this.#globalState,
			wsHandler.actorId,
		);
		if (!actor) {
			logger().warn("received websocket message for nonexistent actor leader", {
				actorId: wsHandler.actorId,
			});
			return;
		}

		// Decode message
		const data = message.binary
			? new Uint8Array(
					atob(message.data)
						.split("")
						.map((c) => c.charCodeAt(0)),
				)
			: message.data;

		// Forward to actor's WebSocket handler
		if (wsHandler.bridge.onmessage) {
			wsHandler.bridge.onmessage({ data } as MessageEvent);
		}
	}

	async #onLeaderWebSocketClose(close: ToLeaderWebSocketClose) {
		const wsHandler = (this.#globalState as any).leaderWebSockets?.get(
			close.wi,
		);
		if (!wsHandler) {
			logger().warn("received websocket close for nonexistent websocket", {
				websocketId: close.wi,
			});
			return;
		}

		// Clean up
		(this.#globalState as any).leaderWebSockets.delete(close.wi);

		// Forward to actor's WebSocket handler
		if (wsHandler.bridge.onclose) {
			wsHandler.bridge.onclose({
				type: "close",
				code: close.code ?? 1005,
				reason: close.reason ?? "",
				wasClean: true,
			} as RivetCloseEvent);
		}
	}

	async #onFollowerWebSocketMessage(message: ToFollowerWebSocketMessage) {
		const ws = this.#globalState.rawWebSockets.get(message.wi);
		if (!ws) {
			logger().warn(
				"received websocket message for nonexistent follower websocket",
				{
					websocketId: message.wi,
				},
			);
			return;
		}

		// Decode and forward message
		const data = message.binary
			? new Uint8Array(
					atob(message.data)
						.split("")
						.map((c) => c.charCodeAt(0)),
				)
			: message.data;

		ws.send(data);
	}

	async #onFollowerWebSocketClose(close: ToFollowerWebSocketClose) {
		const ws = this.#globalState.rawWebSockets.get(close.wi);
		if (!ws) {
			logger().warn(
				"received websocket close for nonexistent follower websocket",
				{
					websocketId: close.wi,
				},
			);
			return;
		}

		// Clean up and close WebSocket
		this.#globalState.rawWebSockets.delete(close.wi);
		ws.close(close.code, close.reason);
	}
}
