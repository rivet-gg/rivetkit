import type { AnyActorDefinition } from "@/actor/definition";
import type { Transport } from "@/actor/protocol/message/mod";
import type * as wsToClient from "@/actor/protocol/message/to-client";
import type * as wsToServer from "@/actor/protocol/message/to-server";
import type { Encoding } from "@/actor/protocol/serde";
import { importEventSource } from "@/common/eventsource";
import { MAX_CONN_PARAMS_SIZE } from "@/common/network";
import { assertUnreachable, stringifyError } from "@/common/utils";
import { importWebSocket } from "@/common/websocket";
import type { ActorQuery } from "@/manager/protocol/query";
import * as cbor from "cbor-x";
import pRetry from "p-retry";
import type { ActorDefinitionRpcs as ActorDefinitionRpcsImport } from "./actor_common";
import { ACTOR_CONNS_SYMBOL, type ClientRaw, TRANSPORT_SYMBOL } from "./client";
import * as errors from "./errors";
import { logger } from "./log";
import { type WebSocketMessage as ConnMessage, messageLength } from "./utils";

// Re-export the type with the original name to maintain compatibility
type ActorDefinitionRpcs<AD extends AnyActorDefinition> =
	ActorDefinitionRpcsImport<AD>;

interface RpcInFlight {
	name: string;
	resolve: (response: wsToClient.RpcResponse) => void;
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

/**
 * A function that handles connection errors.
 *
 * @typedef {Function} ActorErrorCallback
 */
export type ActorErrorCallback = (error: errors.ActorError) => void;

interface SendOpts {
	ephemeral: boolean;
}

export type ConnTransport = { websocket: WebSocket } | { sse: EventSource };

export const CONNECT_SYMBOL = Symbol("connect");

interface DynamicImports {
	WebSocket: typeof WebSocket;
	EventSource: typeof EventSource;
}

/**
 * Provides underlying functions for {@link ActorConn}. See {@link ActorConn} for using type-safe remote procedure calls.
 *
 * @see {@link ActorConn}
 */
export class ActorConnRaw {
	#disposed = false;

	/* Will be aborted on dispose. */
	#abortController = new AbortController();

	/** If attempting to connect. Helpful for knowing if in a retry loop when reconnecting. */
	#connecting = false;

	// These will only be set on SSE driver
	#connectionId?: string;
	#connectionToken?: string;

	#transport?: ConnTransport;

	#messageQueue: wsToServer.ToServer[] = [];
	#rpcInFlight = new Map<number, RpcInFlight>();

	// biome-ignore lint/suspicious/noExplicitAny: Unknown subscription type
	#eventSubscriptions = new Map<string, Set<EventSubscriptions<any[]>>>();

	#errorHandlers = new Set<ActorErrorCallback>();

	#rpcIdCounter = 0;

	/**
	 * Interval that keeps the NodeJS process alive if this is the only thing running.
	 *
	 * See ttps://github.com/nodejs/node/issues/22088
	 */
	#keepNodeAliveInterval: NodeJS.Timeout;

	/** Promise used to indicate the required properties for using this class have loaded. Currently just #dynamicImports */
	#onConstructedPromise: Promise<void>;

	/** Promise used to indicate the socket has connected successfully. This will be rejected if the connection fails. */
	#onOpenPromise?: PromiseWithResolvers<undefined>;

	// TODO: ws message queue

	// External imports
	#dynamicImports!: DynamicImports;

	/**
	 * Do not call this directly.
	 *
	 * Creates an instance of ActorConnRaw.
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
		private readonly actorQuery: ActorQuery,
	) {
		this.#keepNodeAliveInterval = setInterval(() => 60_000);

		this.#onConstructedPromise = (async () => {
			// Import dynamic dependencies
			const [WebSocket, EventSource] = await Promise.all([
				importWebSocket(),
				importEventSource(),
			]);
			this.#dynamicImports = {
				WebSocket,
				EventSource,
			};
		})();
	}

	/**
	 * Call a raw RPC connection. See {@link ActorConn} for type-safe RPC calls.
	 *
	 * @see {@link ActorConn}
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
		await this.#onConstructedPromise;

		logger().debug("action", { name, args });

		// If we have an active connection, use the websocket RPC
		const rpcId = this.#rpcIdCounter;
		this.#rpcIdCounter += 1;

		const { promise, resolve, reject } =
			Promise.withResolvers<wsToClient.RpcResponse>();
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
		try {
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
		} catch (err) {
			if ((err as Error).name === "AbortError") {
				// Ignore abortions
				logger().info("connection retry aborted");
				return;
			} else {
				// Unknown error
				throw err;
			}
		}

		this.#connecting = false;
	}

	async #connectAndWait() {
		try {
			await this.#onConstructedPromise;

			// Create promise for open
			if (this.#onOpenPromise)
				throw new Error("#onOpenPromise already defined");
			this.#onOpenPromise = Promise.withResolvers();

			// Connect transport
			if (this.client[TRANSPORT_SYMBOL] === "websocket") {
				this.#connectWebSocket();
			} else if (this.client[TRANSPORT_SYMBOL] === "sse") {
				this.#connectSse();
			} else {
				assertUnreachable(this.client[TRANSPORT_SYMBOL]);
			}

			// Wait for result
			await this.#onOpenPromise.promise;
		} finally {
			this.#onOpenPromise = undefined;
		}
	}

	#connectWebSocket() {
		const { WebSocket } = this.#dynamicImports;

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
		const { EventSource } = this.#dynamicImports;

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
		logger().trace("received message", {
			dataType: typeof event.data,
			isBlob: event.data instanceof Blob,
			isArrayBuffer: event.data instanceof ArrayBuffer,
		});

		const response = (await this.#parse(event.data)) as wsToClient.ToClient;
		logger().trace("parsed message", {
			response: JSON.stringify(response).substring(0, 100) + "...",
		});

		if ("i" in response.b) {
			// This is only called for SSE
			this.#connectionId = response.b.i.ci;
			this.#connectionToken = response.b.i.ct;
			logger().trace("received init message", {
				connectionId: this.#connectionId,
			});
			this.#handleOnOpen();
		} else if ("e" in response.b) {
			// Connection error
			const { c: code, m: message, md: metadata, ri: rpcId } = response.b.e;

			if (rpcId) {
				const inFlight = this.#takeRpcInFlight(rpcId);

				logger().warn("rpc error", {
					actionId: rpcId,
					actionName: inFlight?.name,
					code,
					message,
					metadata,
				});

				inFlight.reject(new errors.ActorError(code, message, metadata));
			} else {
				logger().warn("connection error", {
					code,
					message,
					metadata,
				});

				// Create a connection error
				const actorError = new errors.ActorError(code, message, metadata);

				// If we have an onOpenPromise, reject it with the error
				if (this.#onOpenPromise) {
					this.#onOpenPromise.reject(actorError);
				}

				// Reject any in-flight requests
				for (const [id, inFlight] of this.#rpcInFlight.entries()) {
					inFlight.reject(actorError);
					this.#rpcInFlight.delete(id);
				}

				// Dispatch to error handler if registered
				this.#dispatchActorError(actorError);
			}
		} else if ("rr" in response.b) {
			// RPC response OK
			const { i: rpcId, o: outputType } = response.b.rr;
			logger().trace("received RPC response", {
				rpcId,
				outputType,
			});

			const inFlight = this.#takeRpcInFlight(rpcId);
			logger().trace("resolving RPC promise", {
				rpcId,
				actionName: inFlight?.name,
			});
			inFlight.resolve(response.b.rr);
		} else if ("ev" in response.b) {
			logger().trace("received event", {
				name: response.b.ev.n,
				argsCount: response.b.ev.a?.length,
			});
			this.#dispatchEvent(response.b.ev);
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
		if (closeEvent.wasClean) {
			logger().info("socket closed", {
				code: closeEvent.code,
				reason: closeEvent.reason,
				wasClean: closeEvent.wasClean,
			});
		} else {
			logger().warn("socket closed", {
				code: closeEvent.code,
				reason: closeEvent.reason,
				wasClean: closeEvent.wasClean,
			});
		}

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

		// More detailed information will be logged in onclose
		logger().warn("socket error", { event });
	}

	#buildConnUrl(transport: Transport): string {
		// Get the manager endpoint from the endpoint provided
		const actorQueryStr = encodeURIComponent(JSON.stringify(this.actorQuery));

		logger().debug("building conn url", {
			transport,
		});

		let url = `${this.endpoint}/actors/connect/${transport}?encoding=${this.encodingKind}&query=${actorQueryStr}`;

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

	#dispatchEvent(event: wsToClient.Event) {
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

	#dispatchActorError(error: errors.ActorError) {
		// Call all registered error handlers
		for (const handler of [...this.#errorHandlers]) {
			try {
				handler(error);
			} catch (err) {
				logger().error("Error in connection error handler", {
					error: stringifyError(err),
				});
			}
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

	/**
	 * Subscribes to connection errors.
	 *
	 * @param {ActorErrorCallback} callback - The callback function to execute when a connection error occurs.
	 * @returns {() => void} - A function to unsubscribe from the error handler.
	 */
	onError(callback: ActorErrorCallback): () => void {
		this.#errorHandlers.add(callback);

		// Return unsubscribe function
		return () => {
			this.#errorHandlers.delete(callback);
		};
	}

	#sendMessage(message: wsToServer.ToServer, opts?: SendOpts) {
		let queueMessage = false;
		if (!this.#transport) {
			// No transport connected yet
			queueMessage = true;
		} else if ("websocket" in this.#transport) {
			const { WebSocket } = this.#dynamicImports;
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
			const { EventSource } = this.#dynamicImports;

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

			// Get the manager endpoint from the endpoint provided
			const actorQueryStr = encodeURIComponent(JSON.stringify(this.actorQuery));

			const url = `${this.endpoint}/actors/connections/${this.#connectionId}/message?encoding=${this.encodingKind}&connectionToken=${encodeURIComponent(this.#connectionToken)}&query=${actorQueryStr}`;

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
		await this.#onConstructedPromise;

		// Internally, this "disposes" the connection

		if (this.#disposed) {
			logger().warn("connection already disconnected");
			return;
		}
		this.#disposed = true;

		logger().debug("disposing actor");

		// Clear interval so NodeJS process can exit
		clearInterval(this.#keepNodeAliveInterval);

		// Abort
		this.#abortController.abort();

		// Remove from registry
		this.client[ACTOR_CONNS_SYMBOL].delete(this);

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

/**
 * Connection to an actor. Allows calling actor's remote procedure calls with inferred types. See {@link ActorConnRaw} for underlying methods.
 *
 * @example
 * ```
 * const room = client.connect<ChatRoom>(...etc...);
 * // This calls the rpc named `sendMessage` on the `ChatRoom` actor.
 * await room.sendMessage('Hello, world!');
 * ```
 *
 * Private methods (e.g. those starting with `_`) are automatically excluded.
 *
 * @template AD The actor class that this connection is for.
 * @see {@link ActorConnRaw}
 */

export type ActorConn<AD extends AnyActorDefinition> = ActorConnRaw &
	ActorDefinitionRpcs<AD>;