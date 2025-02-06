import type { ProtocolFormat } from "@/actor/protocol/ws/mod";
import type * as wsToClient from "@/actor/protocol/ws/to_client";
import * as cbor from "cbor-x";
import type { WSContext } from "hono/ws";
import type { SSEStreamingApi } from "hono/streaming";
import type { AnyActor, ExtractActorConnState } from "./actor";
import * as errors from "./errors";
import { logger } from "./log";
import { assertUnreachable, generateSecureToken } from "./utils";

export type IncomingMessage = string | Blob | ArrayBufferLike;
export type OutgoingMessage = string | ArrayBuffer | Uint8Array;

export type ConnectionId = number;

export type ConnectionTransport =
	| { websocket: WSContext<WebSocket> }
	| { sse: SSEStreamingApi }
	| { http: {} };

/**
 * Represents a client connection to an actor.
 *
 * Manages connection-specific data and controls the connection lifecycle.
 *
 * @see {@link https://rivet.gg/docs/connections|Connection Documentation}
 */
export class Connection<A extends AnyActor> {
	subscriptions: Set<string> = new Set<string>();

	#state: ExtractActorConnState<A> | undefined;
	#stateEnabled: boolean;

	/**
	 * If the actor can send messages to the client.
	 */
	public get _supportsStreamingResponse() {
		if ("websocket" in this.#transport || "sse" in this.#transport) {
			return true;
		} else if ("http" in this.#transport) {
			return false;
		} else {
			assertUnreachable(this.#transport);
		}
	}

	/**
	 * If the client can send messages to the server.
	 */
	public get _supportsStreamingRequest() {
		if ("websocket" in this.#transport) {
			return true;
		} else if ("sse" in this.#transport || "http" in this.#transport) {
			return false;
		} else {
			assertUnreachable(this.#transport);
		}
	}

	/**
	 * Unique identifier for the connection.
	 */
	public readonly id: ConnectionId;

	/**
	 * Token used to authenticate this request.
	 */
	public readonly _token: string;

	/**
	 * Transport used to manage realtime connection communication.
	 *
	 * @protected
	 */
	#transport: ConnectionTransport;

	/**
	 * Protocol format used for message serialization and deserialization.
	 *
	 * @protected
	 */
	public _protocolFormat: ProtocolFormat;

	/**
	 * Gets the current state of the connection.
	 *
	 * Throws an error if the state is not enabled.
	 */
	public get state(): ExtractActorConnState<A> {
		this.#validateStateEnabled();
		if (!this.#state) throw new Error("state should exists");
		return this.#state;
	}

	/**
	 * Sets the state of the connection.
	 *
	 * Throws an error if the state is not enabled.
	 */
	public set state(value: ExtractActorConnState<A>) {
		this.#validateStateEnabled();
		this.#state = value;
	}

	/**
	 * Initializes a new instance of the Connection class.
	 *
	 * This should only be constructed by {@link Actor}.
	 *
	 * @param id - Unique identifier for the connection.
	 * @param transport - Transport used for running the connection.
	 * @param protocolFormat - Protocol format for message serialization and deserialization.
	 * @param state - Initial state of the connection.
	 * @param stateEnabled - Indicates if the state is enabled.
	 * @protected
	 */
	public constructor(
		id: ConnectionId,
		transport: ConnectionTransport,
		protocolFormat: ProtocolFormat,
		state: ExtractActorConnState<A> | undefined,
		stateEnabled: boolean,
	) {
		this.id = id;
		this.#transport = transport;
		this._protocolFormat = protocolFormat;
		this.#state = state;
		this.#stateEnabled = stateEnabled;

		this._token = generateSecureToken();
	}

	#validateStateEnabled() {
		if (!this.#stateEnabled) {
			throw new errors.ConnectionStateNotEnabled();
		}
	}

	/**
	 * Parses incoming WebSocket messages based on the protocol format.
	 *
	 * @param data - The incoming WebSocket message.
	 * @returns The parsed message.
	 * @throws MalformedMessage if the message format is incorrect.
	 *
	 * @protected
	 */
	public async _parse(data: IncomingMessage): Promise<unknown> {
		if (this._protocolFormat === "json") {
			if (typeof data !== "string") {
				logger().warn("received non-string for json parse");
				throw new errors.MalformedMessage();
			}
			return JSON.parse(data);
		}
		if (this._protocolFormat === "cbor") {
			if (data instanceof Blob) {
				const arrayBuffer = await data.arrayBuffer();
				return cbor.decode(new Uint8Array(arrayBuffer));
			}
			if (data instanceof ArrayBuffer) {
				return cbor.decode(new Uint8Array(data));
			}
			logger().warn("received non-binary type for cbor parse");
			throw new errors.MalformedMessage();
		}
		assertUnreachable(this._protocolFormat);
	}

	/**
	 * Serializes a value into a WebSocket message based on the protocol format.
	 *
	 * @param value - The value to serialize.
	 * @returns The serialized message.
	 *
	 * @protected
	 */
	public _serialize(value: wsToClient.ToClient): OutgoingMessage {
		if (this._protocolFormat === "json") {
			return JSON.stringify(value);
		} else if (this._protocolFormat === "cbor") {
			// TODO: Remove this hack, but cbor-x can't handle anything extra in data structures
			const cleanValue = JSON.parse(JSON.stringify(value));
			return cbor.encode(cleanValue);
		} else {
			assertUnreachable(this._protocolFormat);
		}
	}

	private _encodeMessageToString(message: OutgoingMessage): string {
		if (typeof message === "string") {
			return message;
		} else if (message instanceof ArrayBuffer) {
			return base64EncodeArrayBuffer(message);
		} else if (message instanceof Uint8Array) {
			return base64EncodeUint8Array(message);
		} else {
			assertUnreachable(message);
		}
	}

	/**
	 * Sends a WebSocket message to the client.
	 *
	 * @param message - The message to send.
	 *
	 * @protected
	 */
	public _sendMessage(message: OutgoingMessage) {
		if ("websocket" in this.#transport) {
			this.#transport.websocket.send(message);
		} else if ("sse" in this.#transport) {
			// TODO: Validate this is ordered somehow
			// Sends in background
			this.#transport.sse.writeSSE({
				data: this._encodeMessageToString(message),
			});
		} else if ("http" in this.#transport) {
			logger().warn(
				"attempting to send websocket message to connection without websocket",
			);
		} else {
			assertUnreachable(this.#transport);
		}
	}

	/**
	 * Sends an event with arguments to the client.
	 *
	 * @param eventName - The name of the event.
	 * @param args - The arguments for the event.
	 * @see {@link https://rivet.gg/docs/events|Events Documentation}
	 */
	send(eventName: string, ...args: unknown[]) {
		this._sendMessage(
			this._serialize({
				b: {
					ev: {
						n: eventName,
						a: args,
					},
				},
			} satisfies wsToClient.ToClient),
		);
	}

	/**
	 * Disconnects the client with an optional reason.
	 *
	 * @param reason - The reason for disconnection.
	 */
	disconnect(reason?: string) {
		if ("websocket" in this.#transport) {
			this.#transport.websocket.close(1000, reason);
		} else if ("sse" in this.#transport) {
			this.#transport.sse.abort();
		} else if ("http" in this.#transport) {
			// Do nothing
		} else {
			assertUnreachable(this.#transport);
		}
	}

	async shutdown() {
		let gracefulClosePromise: Promise<void> | undefined;
		if ("websocket" in this.#transport) {
			const raw = this.#transport.websocket.raw;
			if (!raw) return;

			// Create deferred promise
			const { promise, resolve } = Promise.withResolvers<void>();
			gracefulClosePromise = promise;

			// Resolve promise when websocket closes
			raw.addEventListener("close", () => resolve());
		} else if ("sse" in this.#transport || "http" in this.#transport) {
			// Do nothing
		} else {
			assertUnreachable(this.#transport);
		}

		// Close connection
		this.disconnect();

		// Wait for socket to close. This allows for the requests to get a graceful exit before completely exiting.
		if (gracefulClosePromise) await gracefulClosePromise;
	}
}

// TODO: Encode base 128
function base64EncodeUint8Array(uint8Array: Uint8Array): string {
	let binary = "";
	const len = uint8Array.byteLength;
	for (let i = 0; i < len; i++) {
		binary += String.fromCharCode(uint8Array[i]);
	}
	return btoa(binary);
}

function base64EncodeArrayBuffer(arrayBuffer: ArrayBuffer): string {
	const uint8Array = new Uint8Array(arrayBuffer);
	return base64EncodeUint8Array(uint8Array);
}
