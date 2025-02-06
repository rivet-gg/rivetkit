import type { Encoding, Transport } from "@/actor/protocol/ws/mod";
import type * as wsToClient from "@/actor/protocol/ws/to_client";
import type * as wsToServer from "@/actor/protocol/ws/to_server";
import { MAX_CONN_PARAMS_SIZE } from "@/common/network";
import { assertUnreachable } from "@/common/utils";
import * as cbor from "cbor-x";
import * as errors from "./errors";
import { logger } from "./log";
import {
	type WebSocketMessage as ConnectionMessage,
	messageLength,
} from "./utils";
import { DynamicImports } from "./client";

interface RpcInFlight {
	name: string;
	resolve: (response: wsToClient.RpcResponseOk) => void;
	reject: (error: Error) => void;
}

interface EventSubscriptions<Args extends Array<unknown>> {
	callback: (...args: Args) => void;
	once: boolean;
}

/**
 * A function that unsubscribes from an event.
 *
 * @typedef {Function} EventUnsubscribe
 */
export type EventUnsubscribe = () => void;

interface SendOpts {
	ephemeral: boolean;
}

export type ConnectionTransport =
	| { websocket: WebSocket }
	| { sse: EventSource };

/**
 * Provides underlying functions for {@link ActorHandle}. See {@link ActorHandle} for using type-safe remote procedure calls.
 *
 * @see {@link ActorHandle}
 */
export class ActorHandleRaw {
	#disconnected = false;

	// These will only be set on SSE driver
	#connectionId?: string;
	#connectionToken?: string;

	#transport?: ConnectionTransport;

	#messageQueue: wsToServer.ToServer[] = [];
	#rpcInFlight = new Map<number, RpcInFlight>();

	// biome-ignore lint/suspicious/noExplicitAny: Unknown subscription type
	#eventSubscriptions = new Map<string, Set<EventSubscriptions<any[]>>>();

	#rpcIdCounter = 0;

	// TODO: ws message queue

	/**
	 * Do not call this directly.
	 *
	 * Creates an instance of ActorHandleRaw.
	 *
	 * @param {string} endpoint - The endpoint to connect to.
	 *
	 * @protected
	 */
	public constructor(
		private readonly endpoint: string,
		private readonly parameters: unknown,
		private readonly encodingKind: Encoding,
		private readonly transportKind: Transport,
		private readonly dynamicImports: DynamicImports,
	) {}

	/**
	 * Call a raw RPC handle. See {@link ActorHandle} for type-safe RPC calls.
	 *
	 * @see {@link ActorHandle}
	 * @template Args - The type of arguments to pass to the RPC function.
	 * @template Response - The type of the response returned by the RPC function.
	 * @param {string} name - The name of the RPC function to call.
	 * @param {...Args} args - The arguments to pass to the RPC function.
	 * @returns {Promise<Response>} - A promise that resolves to the response of the RPC function.
	 */
	async rpc<Args extends Array<unknown> = unknown[], Response = unknown>(
		name: string,
		...args: Args
	): Promise<Response> {
		logger().debug("rpc", { name, args });

		// TODO: Add to queue if socket is not open

		const rpcId = this.#rpcIdCounter;
		this.#rpcIdCounter += 1;

		const { promise, resolve, reject } =
			Promise.withResolvers<wsToClient.RpcResponseOk>();
		this.#rpcInFlight.set(rpcId, { name, resolve, reject });

		this.#sendMessage({
			b: {
				rr: {
					i: rpcId,
					n: name,
					a: args,
				},
			},
		} satisfies wsToServer.ToServer);

		// TODO: Throw error if disconnect is called

		const { i: responseId, o: output } = await promise;
		if (responseId !== rpcId)
			throw new Error(
				`Request ID ${rpcId} does not match response ID ${responseId}`,
			);

		return output as Response;
	}

	//async #rpcHttp<Args extends Array<unknown> = unknown[], Response = unknown>(name: string, ...args: Args): Promise<Response> {
	//	const origin = `${resolved.isTls ? "https": "http"}://${resolved.publicHostname}:${resolved.publicPort}`;
	//	const url = `${origin}/rpc/${encodeURIComponent(name)}`;
	//	const res = await fetch(url, {
	//		method: "POST",
	//		// TODO: Import type from protocol
	//		body: JSON.stringify({
	//			args,
	//		})
	//	});
	//	if (!res.ok) {
	//		throw new Error(`RPC error (${res.statusText}):\n${await res.text()}`);
	//	}
	//	// TODO: Import type from protocol
	//	const resJson: httpRpc.ResponseOk<Response> = await res.json();
	//	return resJson.output;
	//}

	/**
	 * Do not call this directly.
enc
	 * Establishes a connection to the server using the specified endpoint & encoding & driver.
	 *
	 * @protected
	 */
	public connect() {
		this.#disconnected = false;

		if (this.transportKind === "websocket") {
			this.#connectWebSocket();
		} else if (this.transportKind === "sse") {
			this.#connectSse();
		} else {
			assertUnreachable(this.transportKind);
		}
	}

	#connectWebSocket() {
		const { WebSocket } = this.dynamicImports;

		const url = this.#buildConnectionUrl();

		const ws = new WebSocket(url);
		if (this.encodingKind === "cbor") {
			ws.binaryType = "arraybuffer";
		} else if (this.encodingKind == "json") {
			ws.binaryType = "blob";
		} else {
			assertUnreachable(this.encodingKind);
		}
		this.#transport = { websocket: ws };
		ws.onopen = () => {
			this.#handleOnOpen();
		};
		ws.onmessage = async (ev) => {
			this.#handleOnMessage(ev);
		};
		ws.onclose = (ev) => {
			this.#handleOnClose(ev);
		};
		ws.onerror = (ev) => {
			this.#handleOnError(ev);
		};
	}

	#connectSse() {
		const { EventSource } = this.dynamicImports;

		const url = this.#buildConnectionUrl();

		const eventSource = new EventSource(url);
		this.#transport = { sse: eventSource };
		eventSource.onopen = () => {
			logger().debug("eventsource open");
			// #handleOnOpen is called on "i" event
		};
		eventSource.onmessage = (ev) => {
			this.#handleOnMessage(ev);
		};
		eventSource.onerror = (ev) => {
			if (eventSource.readyState === EventSource.CLOSED) {
				this.#handleOnClose(ev);
			} else {
				this.#handleOnError(ev);
			}
		};
	}

	/** Called by the onopen event from drivers. */
	#handleOnOpen() {
		logger().debug("socket open");

		// Resubscribe to all active events
		for (const eventName of this.#eventSubscriptions.keys()) {
			this.#sendSubscription(eventName, true);
		}

		// Flush queue
		//
		// If the message fails to send, the message will be re-queued
		const queue = this.#messageQueue;
		this.#messageQueue = [];
		for (const msg of queue) {
			this.#sendMessage(msg);
		}
	}

	/** Called by the onmessage event from drivers. */
	async #handleOnMessage(event: MessageEvent<any>) {
		const response = (await this.#parse(event.data)) as wsToClient.ToClient;

		if ("i" in response.b) {
			// This is only called for SSE
			this.#connectionId = response.b.i.ci;
			this.#connectionToken = response.b.i.ct;
			this.#handleOnOpen();
		} else if ("ro" in response.b) {
			// RPC response OK

			const { i: rpcId } = response.b.ro;

			const inFlight = this.#takeRpcInFlight(rpcId);
			inFlight.resolve(response.b.ro);
		} else if ("re" in response.b) {
			// RPC response error

			const { i: rpcId, c: code, m: message, md: metadata } = response.b.re;

			const inFlight = this.#takeRpcInFlight(rpcId);

			logger().warn("actor error", {
				rpcId,
				rpcName: inFlight?.name,
				code,
				message,
				metadata,
			});

			inFlight.reject(new errors.RpcError(code, message, metadata));
		} else if ("ev" in response.b) {
			this.#dispatchEvent(response.b.ev);
		} else if ("er" in response.b) {
			const { c: code, m: message, md: metadata } = response.b.er;

			logger().warn("actor error", {
				code,
				message,
				metadata,
			});
		} else {
			assertUnreachable(response.b);
		}
	}

	/** Called by the onclose event from drivers. */
	#handleOnClose(event: Event) {
		// TODO: Handle queue
		// TODO: Reconnect with backoff

		if (event instanceof CloseEvent) {
			logger().debug("socket closed", {
				code: event.code,
				reason: event.reason,
				wasClean: event.wasClean,
			});
		} else {
			logger().debug("socket closed");
		}
		this.#transport = undefined;

		// Automatically reconnect
		if (!this.#disconnected) {
			// TODO: Fetch actor to check if it's destroyed
			// TODO: Add backoff for reconnect
			// TODO: Add a way of preserving connection ID for connection state
			// this.connect(...args);
		}
	}

	/** Called by the onerror event from drivers. */
	#handleOnError(event: Event) {
		if (this.#disconnected) return;
		logger().warn("socket error", { event });
	}

	#buildConnectionUrl(): string {
		let url = `${this.endpoint}/connect/${this.transportKind}?encoding=${this.encodingKind}`;

		if (this.parameters !== undefined) {
			const paramsStr = JSON.stringify(this.parameters);

			// TODO: This is an imprecise count since it doesn't count the full URL length & URI encoding expansion in the URL size
			if (paramsStr.length > MAX_CONN_PARAMS_SIZE) {
				throw new errors.ConnectionParametersTooLong();
			}

			url += `&params=${encodeURIComponent(paramsStr)}`;
		}

		return url;
	}

	#takeRpcInFlight(id: number): RpcInFlight {
		const inFlight = this.#rpcInFlight.get(id);
		if (!inFlight) {
			throw new errors.InternalError(`No in flight response for ${id}`);
		}
		this.#rpcInFlight.delete(id);
		return inFlight;
	}

	#dispatchEvent(event: wsToClient.ToClientEvent) {
		const { n: name, a: args } = event;

		const listeners = this.#eventSubscriptions.get(name);
		if (!listeners) return;

		// Create a new array to avoid issues with listeners being removed during iteration
		for (const listener of [...listeners]) {
			listener.callback(...args);

			// Remove if this was a one-time listener
			if (listener.once) {
				listeners.delete(listener);
			}
		}

		// Clean up empty listener sets
		if (listeners.size === 0) {
			this.#eventSubscriptions.delete(name);
		}
	}

	#addEventSubscription<Args extends Array<unknown>>(
		eventName: string,
		callback: (...args: Args) => void,
		once: boolean,
	): EventUnsubscribe {
		const listener: EventSubscriptions<Args> = {
			callback,
			once,
		};

		let subscriptionSet = this.#eventSubscriptions.get(eventName);
		if (subscriptionSet === undefined) {
			subscriptionSet = new Set();
			this.#eventSubscriptions.set(eventName, subscriptionSet);
			this.#sendSubscription(eventName, true);
		}
		subscriptionSet.add(listener);

		// Return unsubscribe function
		return () => {
			const listeners = this.#eventSubscriptions.get(eventName);
			if (listeners) {
				listeners.delete(listener);
				if (listeners.size === 0) {
					this.#eventSubscriptions.delete(eventName);
					this.#sendSubscription(eventName, false);
				}
			}
		};
	}

	/**
	 * Subscribes to an event that will happen repeatedly.
	 *
	 * @template Args - The type of arguments the event callback will receive.
	 * @param {string} eventName - The name of the event to subscribe to.
	 * @param {(...args: Args) => void} callback - The callback function to execute when the event is triggered.
	 * @returns {EventUnsubscribe} - A function to unsubscribe from the event.
	 * @see {@link https://rivet.gg/docs/events|Events Documentation}
	 */
	on<Args extends Array<unknown> = unknown[]>(
		eventName: string,
		callback: (...args: Args) => void,
	): EventUnsubscribe {
		return this.#addEventSubscription<Args>(eventName, callback, false);
	}

	/**
	 * Subscribes to an event that will be triggered only once.
	 *
	 * @template Args - The type of arguments the event callback will receive.
	 * @param {string} eventName - The name of the event to subscribe to.
	 * @param {(...args: Args) => void} callback - The callback function to execute when the event is triggered.
	 * @returns {EventUnsubscribe} - A function to unsubscribe from the event.
	 * @see {@link https://rivet.gg/docs/events|Events Documentation}
	 */
	once<Args extends Array<unknown> = unknown[]>(
		eventName: string,
		callback: (...args: Args) => void,
	): EventUnsubscribe {
		return this.#addEventSubscription<Args>(eventName, callback, true);
	}

	#sendMessage(message: wsToServer.ToServer, opts?: SendOpts) {
		let queueMessage: boolean = false;
		if (!this.#transport) {
			// No transport connected yet
			queueMessage = true;
		} else if ("websocket" in this.#transport) {
			const { WebSocket } = this.dynamicImports;
			if (this.#transport.websocket.readyState === WebSocket.OPEN) {
				try {
					const messageSerialized = this.#serialize(message);
					this.#transport.websocket.send(messageSerialized);
					logger().debug("sent websocket message", {
						len: messageLength(messageSerialized),
					});
				} catch (error) {
					logger().warn("failed to send message, added to queue", {
						error,
					});

					// Assuming the socket is disconnected and will be reconnected soon
					//
					// Will attempt to resend soon
					this.#messageQueue.unshift(message);
				}
			} else {
				queueMessage = true;
			}
		} else if ("sse" in this.#transport) {
			const { EventSource } = this.dynamicImports;

			if (this.#transport.sse.readyState === EventSource.OPEN) {
				// Spawn in background since #sendMessage cannot be async
				this.#sendHttpMessage(message, opts);
			} else {
				queueMessage = true;
			}
		} else {
			assertUnreachable(this.#transport);
		}

		if (!opts?.ephemeral && queueMessage) {
			this.#messageQueue.push(message);
			logger().debug("queued connection message");
		}
	}

	async #sendHttpMessage(message: wsToServer.ToServer, opts?: SendOpts) {
		try {
			if (!this.#connectionId || !this.#connectionToken)
				throw new errors.InternalError("Missing connection ID or token.");

			let url = `${this.endpoint}/connections/${this.#connectionId}/message?encoding=${this.encodingKind}&connectionToken=${encodeURIComponent(this.#connectionToken)}`;

			// TODO: Implement ordered messages, this is not guaranteed order. Needs to use an index in order to ensure we can pipeline requests efficiently.
			// TODO: Validate that we're using HTTP/3 whenever possible for pipelining requests
			const messageSerialized = this.#serialize(message);
			const res = await fetch(url, {
				method: "POST",
				body: messageSerialized,
			});

			if (!res.ok) {
				throw new errors.InternalError(
					`Publish message over HTTP error (${res.statusText}):\n${await res.text()}`,
				);
			}

			// Dispose of the response body, we don't care about it
			await res.json();
		} catch (error) {
			// TODO: This will not automatically trigger a re-broadcast of HTTP events since SSE is separate from the HTTP RPC

			logger().warn("failed to send message, added to queue", {
				error,
			});

			// Assuming the socket is disconnected and will be reconnected soon
			//
			// Will attempt to resend soon
			if (!opts?.ephemeral) {
				this.#messageQueue.unshift(message);
			}
		}
	}

	async #parse(data: ConnectionMessage): Promise<unknown> {
		if (this.encodingKind === "json") {
			if (typeof data !== "string") {
				throw new Error("received non-string for json parse");
			}
			return JSON.parse(data);
		} else if (this.encodingKind === "cbor") {
			if (this.transportKind === "sse") {
				// Decode base64 since SSE sends raw strings
				if (typeof data === "string") {
					const binaryString = atob(data);
					data = new Uint8Array(
						[...binaryString].map((char) => char.charCodeAt(0)),
					);
				} else {
					throw new errors.InternalError(
						`Expected data to be a string for SSE, got ${data}.`,
					);
				}
			} else if (this.transportKind === "websocket") {
				// Do nothing
			} else {
				assertUnreachable(this.transportKind);
			}

			// Decode data
			if (data instanceof Blob) {
				return cbor.decode(new Uint8Array(await data.arrayBuffer()));
			} else if (data instanceof ArrayBuffer) {
				return cbor.decode(new Uint8Array(data));
			} else if (data instanceof Uint8Array) {
				return cbor.decode(data);
			} else {
				throw new Error(
					`received non-binary type for cbor parse: ${typeof data}`,
				);
			}
		} else {
			assertUnreachable(this.encodingKind);
		}
	}

	#serialize(value: unknown): ConnectionMessage {
		if (this.encodingKind === "json") {
			return JSON.stringify(value);
		} else if (this.encodingKind === "cbor") {
			return cbor.encode(value);
		} else {
			assertUnreachable(this.encodingKind);
		}
	}

	// TODO: Add destructor

	/**
	 * Disconnects the WebSocket connection.
	 *
	 * @returns {Promise<void>} A promise that resolves when the WebSocket connection is closed.
	 */
	disconnect(): Promise<void> {
		return new Promise((resolve) => {
			if (!this.#transport) {
				logger().debug("already disconnected");
				return;
			}

			this.#disconnected = true;

			logger().debug("disconnecting");

			// TODO: What do we do with the queue?

			if ("websocket" in this.#transport) {
				this.#transport.websocket.addEventListener("close", () => resolve());
				this.#transport.websocket.close();
			} else if ("sse" in this.#transport) {
				this.#transport.sse.close();
			} else {
				assertUnreachable(this.#transport);
			}
			this.#transport = undefined;
		});
	}

	/**
	 * Disposes of the ActorHandleRaw instance by disconnecting the WebSocket connection.
	 *
	 * @returns {Promise<void>} A promise that resolves when the WebSocket connection is closed.
	 */
	async dispose(): Promise<void> {
		logger().debug("disposing");

		// TODO: this will error if not usable
		await this.disconnect();
	}

	#sendSubscription(eventName: string, subscribe: boolean) {
		this.#sendMessage(
			{
				b: {
					sr: {
						e: eventName,
						s: subscribe,
					},
				},
			},
			{ ephemeral: true },
		);
	}
}
