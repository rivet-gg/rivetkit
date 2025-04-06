import type { Transport } from "@/actor/protocol/message/mod";
import type { Encoding } from "@/actor/protocol/serde";
import type * as wsToClient from "@/actor/protocol/message/to-client";
import type * as wsToServer from "@/actor/protocol/message/to-server";
import { MAX_CONN_PARAMS_SIZE } from "@/common/network";
import { assertUnreachable, stringifyError } from "@/common/utils";
import * as cbor from "cbor-x";
import * as errors from "./errors";
import { logger } from "./log";
import { type WebSocketMessage as ConnMessage, messageLength } from "./utils";
import { ACTOR_HANDLES_SYMBOL, ClientRaw, DynamicImports } from "./client";
import { ActorDefinition, AnyActorDefinition } from "@/actor/definition";
import pRetry from "p-retry";

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

export type ConnTransport = { websocket: WebSocket } | { sse: EventSource };

export const CONNECT_SYMBOL = Symbol("connect");

/**
 * Provides underlying functions for {@link ActorHandle}. See {@link ActorHandle} for using type-safe remote procedure calls.
 *
 * @see {@link ActorHandle}
 */
export class ActorHandleRaw {
	#disposed = false;

	/* Will be aborted on dispose. */
	#abortController = new AbortController();

	/** If attempting to connect. Helpful for knowing if in a retry loop when reconnecting. */
	#connecting: boolean = false;

	// These will only be set on SSE driver
	#connectionId?: string;
	#connectionToken?: string;

	#transport?: ConnTransport;

	#messageQueue: wsToServer.ToServer[] = [];
	#rpcInFlight = new Map<number, RpcInFlight>();

	// biome-ignore lint/suspicious/noExplicitAny: Unknown subscription type
	#eventSubscriptions = new Map<string, Set<EventSubscriptions<any[]>>>();

	#rpcIdCounter = 0;

	/**
	 * Interval that keeps the NodeJS process alive if this is the only thing running.
	 *
	 * See ttps://github.com/nodejs/node/issues/22088
	 */
	#keepNodeAliveInterval: NodeJS.Timeout;

	/** Promise used to indicate the socket has connected successfully. This will be rejected if the connection fails. */
	#onOpenPromise?: PromiseWithResolvers<undefined>;

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
		private readonly client: ClientRaw,
		private readonly endpoint: string,
		private readonly params: unknown,
		private readonly encodingKind: Encoding,
		private readonly supportedTransports: Transport[],
		private readonly serverTransports: Transport[],
		private readonly dynamicImports: DynamicImports,
	) {
		this.#keepNodeAliveInterval = setInterval(() => 60_000);
	}

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
	async action<Args extends Array<unknown> = unknown[], Response = unknown>(
		name: string,
		...args: Args
	): Promise<Response> {
		logger().debug("action", { name, args });

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
	public [CONNECT_SYMBOL]() {
		this.#connectWithRetry();
	}

	async #connectWithRetry() {
		this.#connecting = true;

		// Attempt to reconnect indefinitely
		await pRetry(this.#connectAndWait.bind(this), {
			forever: true,
			minTimeout: 250,
			maxTimeout: 30_000,

			onFailedAttempt: (error) => {
				logger().warn("failed to reconnect", {
					attempt: error.attemptNumber,
					error: stringifyError(error),
				});
			},

			// Cancel retry if aborted
			signal: this.#abortController.signal,
		});

		this.#connecting = false;
	}

	async #connectAndWait() {
		try {
			// Create promise for open
			if (this.#onOpenPromise)
				throw new Error("#onOpenPromise already defined");
			this.#onOpenPromise = Promise.withResolvers();

			// Connect transport
			const transport = this.#pickTransport();
			if (transport === "websocket") {
				this.#connectWebSocket();
			} else if (transport === "sse") {
				this.#connectSse();
			} else {
				assertUnreachable(transport);
			}

			// Wait for result
			await this.#onOpenPromise.promise;
		} finally {
			this.#onOpenPromise = undefined;
		}
	}

	#pickTransport(): Transport {
		// Choose first supported transport from server's list that client also supports
		const transport = this.serverTransports.find((t) =>
			this.supportedTransports.includes(t),
		);

		if (!transport) {
			throw new errors.NoSupportedTransport();
		}

		return transport;
	}

	#connectWebSocket() {
		const { WebSocket } = this.dynamicImports;

		const url = this.#buildConnUrl("websocket");

		logger().debug("connecting to websocket", { url });
		const ws = new WebSocket(url);
		if (this.encodingKind === "cbor") {
			ws.binaryType = "arraybuffer";
		} else if (this.encodingKind === "json") {
			// HACK: Bun bug prevents changing binary type, so we ignore the error https://github.com/oven-sh/bun/issues/17005
			try {
				ws.binaryType = "blob";
			} catch (error) {}
		} else {
			assertUnreachable(this.encodingKind);
		}
		this.#transport = { websocket: ws };
		ws.onopen = () => {
			logger().debug("websocket open");
			// #handleOnOpen is called on "i" event
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

		const url = this.#buildConnUrl("sse");

		logger().debug("connecting to sse", { url });
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
				// This error indicates a close event
				this.#handleOnClose(ev);
			} else {
				// Log error since event source is still open
				this.#handleOnError(ev);
			}
		};
	}

	/** Called by the onopen event from drivers. */
	#handleOnOpen() {
		logger().debug("socket open", {
			messageQueueLength: this.#messageQueue.length,
		});

		// Resolve open promise
		if (this.#onOpenPromise) {
			this.#onOpenPromise.resolve(undefined);
		} else {
			logger().warn("#onOpenPromise is undefined");
		}

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
				actionId: rpcId,
				actionName: inFlight?.name,
				code,
				message,
				metadata,
			});

			inFlight.reject(new errors.ActionError(code, message, metadata));
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
	#handleOnClose(event: Event | CloseEvent) {
		// TODO: Handle queue
		// TODO: Reconnect with backoff

		// Reject open promise
		if (this.#onOpenPromise) {
			this.#onOpenPromise.reject(new Error("Closed"));
		}

		// We can't use `event instanceof CloseEvent` because it's not defined in NodeJS
		//
		// These properties will be undefined
		const closeEvent = event as CloseEvent;
		logger().debug("socket closed", {
			code: closeEvent.code,
			reason: closeEvent.reason,
			wasClean: closeEvent.wasClean,
		});

		this.#transport = undefined;

		// Automatically reconnect. Skip if already attempting to connect.
		if (!this.#disposed && !this.#connecting) {
			// TODO: Fetch actor to check if it's destroyed
			// TODO: Add backoff for reconnect
			// TODO: Add a way of preserving connection ID for connection state

			// Attempt to connect again
			this.#connectWithRetry();
		}
	}

	/** Called by the onerror event from drivers. */
	#handleOnError(event: Event) {
		if (this.#disposed) return;
		logger().warn("socket error", { event });
	}

	#buildConnUrl(transport: Transport): string {
		let url = `${this.endpoint}/connect/${transport}?encoding=${this.encodingKind}`;

		if (this.params !== undefined) {
			const paramsStr = JSON.stringify(this.params);

			// TODO: This is an imprecise count since it doesn't count the full URL length & URI encoding expansion in the URL size
			if (paramsStr.length > MAX_CONN_PARAMS_SIZE) {
				throw new errors.ConnParamsTooLong();
			}

			url += `&params=${encodeURIComponent(paramsStr)}`;
		}

		if (transport === "websocket") {
			url = url.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
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
						message: message,
						len: messageLength(messageSerialized),
					});
				} catch (error) {
					logger().warn("failed to send message, added to queue", {
						error,
					});

					// Assuming the socket is disconnected and will be reconnected soon
					queueMessage = true;
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

	async #parse(data: ConnMessage): Promise<unknown> {
		if (this.encodingKind === "json") {
			if (typeof data !== "string") {
				throw new Error("received non-string for json parse");
			}
			return JSON.parse(data);
		} else if (this.encodingKind === "cbor") {
			if (!this.#transport) {
				// Do thing
				throw new Error("Cannot parse message when no transport defined");
			} else if ("sse" in this.#transport) {
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
			} else if ("websocket" in this.#transport) {
				// Do nothing
			} else {
				assertUnreachable(this.#transport);
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

	#serialize(value: unknown): ConnMessage {
		if (this.encodingKind === "json") {
			return JSON.stringify(value);
		} else if (this.encodingKind === "cbor") {
			return cbor.encode(value);
		} else {
			assertUnreachable(this.encodingKind);
		}
	}

	/**
	 * Disconnects from the actor.
	 *
	 * @returns {Promise<void>} A promise that resolves when the socket is gracefully closed.
	 */
	async dispose(): Promise<void> {
		// Internally, this "disposes" the handle

		if (this.#disposed) {
			logger().warn("handle already disconnected");
			return;
		}
		this.#disposed = true;

		logger().debug("disposing actor");

		// Clear interval so NodeJS process can exit
		clearInterval(this.#keepNodeAliveInterval);

		// Abort
		this.#abortController.abort();

		// Remove from registry
		this.client[ACTOR_HANDLES_SYMBOL].delete(this);

		// Disconnect transport cleanly
		if (!this.#transport) {
			// Nothing to do
		} else if ("websocket" in this.#transport) {
			const { promise, resolve } = Promise.withResolvers();
			this.#transport.websocket.addEventListener("close", () =>
				resolve(undefined),
			);
			this.#transport.websocket.close();
			await promise;
		} else if ("sse" in this.#transport) {
			this.#transport.sse.close();
		} else {
			assertUnreachable(this.#transport);
		}
		this.#transport = undefined;
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

type ExtractActorDefinitionRpcs<AD extends AnyActorDefinition> =
	AD extends ActorDefinition<any, any, any, any, infer R> ? R : never;

type ActorDefinitionRpcs<AD extends AnyActorDefinition> = {
	[K in keyof ExtractActorDefinitionRpcs<AD>]: ExtractActorDefinitionRpcs<AD>[K] extends (
		...args: infer Args
	) => infer Return
		? ActorRPCFunction<Args, Return>
		: never;
};

/**
 * Connection to an actor. Allows calling actor's remote procedure calls with inferred types. See {@link ActorHandleRaw} for underlying methods.
 *
 * @example
 * ```
 * const room = await client.get<ChatRoom>(...etc...);
 * // This calls the rpc named `sendMessage` on the `ChatRoom` actor.
 * await room.sendMessage('Hello, world!');
 * ```
 *
 * Private methods (e.g. those starting with `_`) are automatically excluded.
 *
 * @template AD The actor class that this handle is connected to.
 * @see {@link ActorHandleRaw}
 */

export type ActorHandle<AD extends AnyActorDefinition> = ActorHandleRaw &
	ActorDefinitionRpcs<AD>;

//{
//	[K in keyof A as K extends string ? K extends `_${string}` ? never : K : K]: A[K] extends (...args: infer Args) => infer Return ? ActorRPCFunction<Args, Return> : never;
//};
/**
 * RPC function returned by `ActorHandle`. This will call `ActorHandle.rpc` when triggered.
 *
 * @typedef {Function} ActorRPCFunction
 * @template Args
 * @template Response
 * @param {...Args} args - Arguments for the RPC function.
 * @returns {Promise<Response>}
 */

export type ActorRPCFunction<
	Args extends Array<unknown> = unknown[],
	Response = unknown,
> = (
	...args: Args extends [unknown, ...infer Rest] ? Rest : Args
) => Promise<Response>;
