import * as cbor from "cbor-x";
import invariant from "invariant";
import pRetry from "p-retry";
import type { CloseEvent, WebSocket } from "ws";
import type { AnyActorDefinition } from "@/actor/definition";
import { inputDataToBuffer } from "@/actor/protocol/old";
import { type Encoding, jsonStringifyCompat } from "@/actor/protocol/serde";
import type {
	UniversalErrorEvent,
	UniversalEventSource,
	UniversalMessageEvent,
} from "@/common/eventsource-interface";
import { assertUnreachable, stringifyError } from "@/common/utils";
import type { ActorQuery } from "@/manager/protocol/query";
import type * as protocol from "@/schemas/client-protocol/mod";
import {
	TO_CLIENT_VERSIONED,
	TO_SERVER_VERSIONED,
} from "@/schemas/client-protocol/versioned";
import {
	deserializeWithEncoding,
	encodingIsBinary,
	serializeWithEncoding,
} from "@/serde";
import { bufferToArrayBuffer, getEnvUniversal } from "@/utils";
import type { ActorDefinitionActions } from "./actor-common";
import {
	ACTOR_CONNS_SYMBOL,
	type ClientDriver,
	type ClientRaw,
	TRANSPORT_SYMBOL,
} from "./client";
import * as errors from "./errors";
import { logger } from "./log";
import { type WebSocketMessage as ConnMessage, messageLength } from "./utils";

interface ActionInFlight {
	name: string;
	resolve: (response: protocol.ActionResponse) => void;
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

export interface SendHttpMessageOpts {
	ephemeral: boolean;
	signal?: AbortSignal;
}

export type ConnTransport =
	| { websocket: WebSocket }
	| { sse: UniversalEventSource };

export const CONNECT_SYMBOL = Symbol("connect");

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
	#actorId?: string;
	#connectionId?: string;
	#connectionToken?: string;

	#transport?: ConnTransport;

	#messageQueue: protocol.ToServer[] = [];
	#actionsInFlight = new Map<number, ActionInFlight>();

	// biome-ignore lint/suspicious/noExplicitAny: Unknown subscription type
	#eventSubscriptions = new Map<string, Set<EventSubscriptions<any[]>>>();

	#errorHandlers = new Set<ActorErrorCallback>();

	#actionIdCounter = 0;

	/**
	 * Interval that keeps the NodeJS process alive if this is the only thing running.
	 *
	 * See ttps://github.com/nodejs/node/issues/22088
	 */
	#keepNodeAliveInterval: NodeJS.Timeout;

	/** Promise used to indicate the socket has connected successfully. This will be rejected if the connection fails. */
	#onOpenPromise?: PromiseWithResolvers<undefined>;

	#client: ClientRaw;
	#driver: ClientDriver;
	#params: unknown;
	#encodingKind: Encoding;
	#actorQuery: ActorQuery;

	// TODO: ws message queue

	/**
	 * Do not call this directly.
	 *
	 * Creates an instance of ActorConnRaw.
	 *
	 * @protected
	 */
	public constructor(
		client: ClientRaw,
		driver: ClientDriver,
		params: unknown,
		encodingKind: Encoding,
		actorQuery: ActorQuery,
	) {
		this.#client = client;
		this.#driver = driver;
		this.#params = params;
		this.#encodingKind = encodingKind;
		this.#actorQuery = actorQuery;

		this.#keepNodeAliveInterval = setInterval(() => 60_000);
	}

	/**
	 * Call a raw action connection. See {@link ActorConn} for type-safe action calls.
	 *
	 * @see {@link ActorConn}
	 * @template Args - The type of arguments to pass to the action function.
	 * @template Response - The type of the response returned by the action function.
	 * @param {string} name - The name of the action function to call.
	 * @param {...Args} args - The arguments to pass to the action function.
	 * @returns {Promise<Response>} - A promise that resolves to the response of the action function.
	 */
	async action<
		Args extends Array<unknown> = unknown[],
		Response = unknown,
	>(opts: {
		name: string;
		args: Args;
		signal?: AbortSignal;
	}): Promise<Response> {
		logger().debug("action", { name: opts.name, args: opts.args });

		// If we have an active connection, use the websockactionId
		const actionId = this.#actionIdCounter;
		this.#actionIdCounter += 1;

		const { promise, resolve, reject } =
			Promise.withResolvers<protocol.ActionResponse>();
		this.#actionsInFlight.set(actionId, { name: opts.name, resolve, reject });

		this.#sendMessage({
			body: {
				tag: "ActionRequest",
				val: {
					id: BigInt(actionId),
					name: opts.name,
					args: bufferToArrayBuffer(cbor.encode(opts.args)),
				},
			},
		} satisfies protocol.ToServer);

		// TODO: Throw error if disconnect is called

		const { id: responseId, output } = await promise;
		if (responseId !== BigInt(actionId))
			throw new Error(
				`Request ID ${actionId} does not match response ID ${responseId}`,
			);

		return cbor.decode(new Uint8Array(output)) as Response;
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
			// Create promise for open
			if (this.#onOpenPromise)
				throw new Error("#onOpenPromise already defined");
			this.#onOpenPromise = Promise.withResolvers();

			// Connect transport
			if (this.#client[TRANSPORT_SYMBOL] === "websocket") {
				await this.#connectWebSocket();
			} else if (this.#client[TRANSPORT_SYMBOL] === "sse") {
				await this.#connectSse();
			} else {
				assertUnreachable(this.#client[TRANSPORT_SYMBOL]);
			}

			// Wait for result
			await this.#onOpenPromise.promise;
		} finally {
			this.#onOpenPromise = undefined;
		}
	}

	async #connectWebSocket({ signal }: { signal?: AbortSignal } = {}) {
		const ws = await this.#driver.connectWebSocket(
			undefined,
			this.#actorQuery,
			this.#encodingKind,
			this.#params,
			signal ? { signal } : undefined,
		);
		this.#transport = { websocket: ws };
		ws.addEventListener("open", () => {
			logger().debug("websocket open");
		});
		ws.addEventListener("message", async (ev) => {
			this.#handleOnMessage(ev.data);
		});
		ws.addEventListener("close", (ev) => {
			this.#handleOnClose(ev);
		});
		ws.addEventListener("error", (_ev) => {
			this.#handleOnError();
		});
	}

	async #connectSse({ signal }: { signal?: AbortSignal } = {}) {
		const eventSource = await this.#driver.connectSse(
			undefined,
			this.#actorQuery,
			this.#encodingKind,
			this.#params,
			signal ? { signal } : undefined,
		);
		this.#transport = { sse: eventSource };
		eventSource.onopen = () => {
			logger().debug("eventsource open");
			// #handleOnOpen is called on "i" event
		};
		eventSource.onmessage = (ev: UniversalMessageEvent) => {
			this.#handleOnMessage(ev.data);
		};
		eventSource.onerror = (_ev: UniversalErrorEvent) => {
			if (eventSource.readyState === eventSource.CLOSED) {
				// This error indicates a close event
				this.#handleOnClose(new Event("error"));
			} else {
				// Log error since event source is still open
				this.#handleOnError();
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
	async #handleOnMessage(data: any) {
		logger().trace("received message", {
			dataType: typeof data,
			isBlob: data instanceof Blob,
			isArrayBuffer: data instanceof ArrayBuffer,
		});

		const response = await this.#parseMessage(data as ConnMessage);
		logger().trace(
			"parsed message",
			getEnvUniversal("_RIVETKIT_LOG_MESSAGE")
				? {
						message: jsonStringifyCompat(response).substring(0, 100) + "...",
					}
				: {},
		);

		if (response.body.tag === "Init") {
			// This is only called for SSE
			this.#actorId = response.body.val.actorId;
			this.#connectionId = response.body.val.connectionId;
			this.#connectionToken = response.body.val.connectionToken;
			logger().trace("received init message", {
				actorId: this.#actorId,
				connectionId: this.#connectionId,
			});
			this.#handleOnOpen();
		} else if (response.body.tag === "Error") {
			// Connection error
			const { code, message, metadata, actionId } = response.body.val;

			if (actionId) {
				const inFlight = this.#takeActionInFlight(Number(actionId));

				logger().warn("action error", {
					actionId: actionId,
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
				for (const [id, inFlight] of this.#actionsInFlight.entries()) {
					inFlight.reject(actorError);
					this.#actionsInFlight.delete(id);
				}

				// Dispatch to error handler if registered
				this.#dispatchActorError(actorError);
			}
		} else if (response.body.tag === "ActionResponse") {
			// Action response OK
			const { id: actionId } = response.body.val;
			logger().trace("received action response", {
				actionId,
			});

			const inFlight = this.#takeActionInFlight(Number(actionId));
			logger().trace("resolving action promise", {
				actionId,
				actionName: inFlight?.name,
			});
			inFlight.resolve(response.body.val);
		} else if (response.body.tag === "Event") {
			logger().trace("received event", { name: response.body.val.name });
			this.#dispatchEvent(response.body.val);
		} else {
			assertUnreachable(response.body);
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
	#handleOnError() {
		if (this.#disposed) return;

		// More detailed information will be logged in onclose
		logger().warn("socket error");
	}

	#takeActionInFlight(id: number): ActionInFlight {
		const inFlight = this.#actionsInFlight.get(id);
		if (!inFlight) {
			throw new errors.InternalError(`No in flight response for ${id}`);
		}
		this.#actionsInFlight.delete(id);
		return inFlight;
	}

	#dispatchEvent(event: protocol.Event) {
		const { name, args: argsRaw } = event;
		const args = cbor.decode(new Uint8Array(argsRaw));

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

	#sendMessage(message: protocol.ToServer, opts?: SendHttpMessageOpts) {
		if (this.#disposed) {
			throw new errors.ActorConnDisposed();
		}

		let queueMessage = false;
		if (!this.#transport) {
			// No transport connected yet
			queueMessage = true;
		} else if ("websocket" in this.#transport) {
			if (this.#transport.websocket.readyState === 1) {
				try {
					const messageSerialized = serializeWithEncoding(
						this.#encodingKind,
						message,
						TO_SERVER_VERSIONED,
					);
					this.#transport.websocket.send(messageSerialized);
					logger().trace("sent websocket message", {
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
			if (this.#transport.sse.readyState === 1) {
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

	async #sendHttpMessage(
		message: protocol.ToServer,
		opts?: SendHttpMessageOpts,
	) {
		try {
			if (!this.#actorId || !this.#connectionId || !this.#connectionToken)
				throw new errors.InternalError("Missing connection ID or token.");

			logger().trace(
				"sent http message",
				getEnvUniversal("_RIVETKIT_LOG_MESSAGE")
					? {
							message: jsonStringifyCompat(message).substring(0, 100) + "...",
						}
					: {},
			);

			await this.#driver.sendHttpMessage(
				undefined,
				this.#actorId,
				this.#encodingKind,
				this.#connectionId,
				this.#connectionToken,
				message,
				opts?.signal ? { signal: opts.signal } : undefined,
			);
		} catch (error) {
			// TODO: This will not automatically trigger a re-broadcast of HTTP events since SSE is separate from the HTTP action

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

	async #parseMessage(data: ConnMessage): Promise<protocol.ToClient> {
		invariant(this.#transport, "transport must be defined");

		// Decode base64 since SSE sends raw strings
		if (encodingIsBinary(this.#encodingKind) && "sse" in this.#transport) {
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
		}

		const buffer = await inputDataToBuffer(data);

		return deserializeWithEncoding(
			this.#encodingKind,
			buffer,
			TO_CLIENT_VERSIONED,
		);
	}

	/**
	 * Disconnects from the actor.
	 *
	 * @returns {Promise<void>} A promise that resolves when the socket is gracefully closed.
	 */
	async dispose(): Promise<void> {
		// Internally, this "disposes" the connection

		if (this.#disposed) {
			logger().warn("connection already disconnected");
			return;
		}
		this.#disposed = true;

		logger().debug("disposing actor conn");

		// Clear interval so NodeJS process can exit
		clearInterval(this.#keepNodeAliveInterval);

		// Abort
		this.#abortController.abort();

		// Remove from registry
		this.#client[ACTOR_CONNS_SYMBOL].delete(this);

		// Disconnect transport cleanly
		if (!this.#transport) {
			// Nothing to do
		} else if ("websocket" in this.#transport) {
			const ws = this.#transport.websocket;
			// Check if WebSocket is already closed or closing
			if (
				ws.readyState === 2 /* CLOSING */ ||
				ws.readyState === 3 /* CLOSED */
			) {
				logger().debug("ws already closed or closing");
			} else {
				const { promise, resolve } = Promise.withResolvers();
				ws.addEventListener("close", () => {
					logger().debug("ws closed");
					resolve(undefined);
				});
				ws.close();
				await promise;
			}
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
				body: {
					tag: "SubscriptionRequest",
					val: {
						eventName,
						subscribe,
					},
				},
			},
			{ ephemeral: true },
		);
	}
}

/**
 * Connection to a actor. Allows calling actor's remote procedure calls with inferred types. See {@link ActorConnRaw} for underlying methods.
 *
 * @example
 * ```
 * const room = client.connect<ChatRoom>(...etc...);
 * // This calls the action named `sendMessage` on the `ChatRoom` actor.
 * await room.sendMessage('Hello, world!');
 * ```
 *
 * Private methods (e.g. those starting with `_`) are automatically excluded.
 *
 * @template AD The actor class that this connection is for.
 * @see {@link ActorConnRaw}
 */
export type ActorConn<AD extends AnyActorDefinition> = ActorConnRaw &
	ActorDefinitionActions<AD>;
