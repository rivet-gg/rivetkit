import { parseMessage } from "@/actor/protocol/message/mod";
import type * as messageToServer from "@/actor/protocol/message/to-server";
import type { InputData } from "@/actor/protocol/serde";
import type { ConnectWebSocketOutput } from "@/actor/router-endpoints";
import { logger } from "@/registry/log";
import { WSContext } from "hono/ws";
import type { CloseEvent, Event, MessageEvent } from "ws";

/**
 * FakeWebSocket implements a WebSocket-like interface
 * that connects to a ConnectWebSocketOutput handler
 */
export class FakeWebSocket {
	// WebSocket readyState values
	readonly CONNECTING = 0 as const;
	readonly OPEN = 1 as const;
	readonly CLOSING = 2 as const;
	readonly CLOSED = 3 as const;

	// Private properties
	#handler: ConnectWebSocketOutput;
	#wsContext: WSContext;
	#readyState: 0 | 1 | 2 | 3 = 0; // Start in CONNECTING state
	#queuedMessages: Array<string | ArrayBuffer | Uint8Array> = [];
	// Event buffering is needed since onopen/onmessage events can be fired
	// before JavaScript has a chance to assign handlers (e.g. within the same tick)
	#bufferedEvents: Array<{
		type: "open" | "close" | "error" | "message";
		event: any;
	}> = [];

	// Event handlers with buffering
	#onopen: ((ev: any) => void) | null = null;
	#onclose: ((ev: any) => void) | null = null;
	#onerror: ((ev: any) => void) | null = null;
	#onmessage: ((ev: any) => void) | null = null;

	get onopen() {
		return this.#onopen;
	}
	set onopen(handler: ((ev: any) => void) | null) {
		this.#onopen = handler;
		if (handler) this.#flushBufferedEvents("open");
	}

	get onclose() {
		return this.#onclose;
	}
	set onclose(handler: ((ev: any) => void) | null) {
		this.#onclose = handler;
		if (handler) this.#flushBufferedEvents("close");
	}

	get onerror() {
		return this.#onerror;
	}
	set onerror(handler: ((ev: any) => void) | null) {
		this.#onerror = handler;
		if (handler) this.#flushBufferedEvents("error");
	}

	get onmessage() {
		return this.#onmessage;
	}
	set onmessage(handler: ((ev: any) => void) | null) {
		this.#onmessage = handler;
		if (handler) this.#flushBufferedEvents("message");
	}

	constructor(handler: ConnectWebSocketOutput) {
		this.#handler = handler;

		// Create a fake WSContext to pass to the handler
		this.#wsContext = new WSContext({
			send: (data: string | ArrayBuffer | Uint8Array) => {
				logger().debug("WSContext.send called");
				this.#handleMessage(data);
			},
			close: (code?: number, reason?: string) => {
				logger().debug("WSContext.close called", { code, reason });
				this.#handleClose(code || 1000, reason || "");
			},
			// Set readyState to 1 (OPEN) since handlers expect an open connection
			readyState: 1,
		});

		// Initialize the connection
		this.#initialize();
	}

	get readyState(): 0 | 1 | 2 | 3 {
		return this.#readyState;
	}

	send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
		logger().debug("send called", { readyState: this.readyState });

		if (this.readyState !== this.OPEN) {
			const error = new Error("WebSocket is not open");
			logger().warn("cannot send message, websocket not open", {
				readyState: this.readyState,
				dataType: typeof data,
				dataLength: typeof data === "string" ? data.length : "binary",
				error,
			});
			this.#fireError(error);
			return;
		}

		try {
			// Handle different data types
			if (typeof data === "string") {
				// For string data, parse as JSON
				logger().debug("parsing JSON string message", {
					dataLength: data.length,
				});
				const message = JSON.parse(data) as messageToServer.ToServer;

				this.#handler.onMessage(message).catch((err) => {
					logger().error("error handling websocket message", {
						error: err,
						errorMessage: err instanceof Error ? err.message : String(err),
						stack: err instanceof Error ? err.stack : undefined,
					});
					this.#fireError(err);
				});
			} else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
				// Convert to Uint8Array if needed
				const uint8Array =
					data instanceof ArrayBuffer
						? new Uint8Array(data)
						: new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

				logger().debug("sending binary message", {
					dataLength: uint8Array.byteLength,
				});

				// Parse the binary message
				this.#parseBinaryMessage(uint8Array);
			} else if (data instanceof Blob) {
				logger().debug("sending blob message", { blobSize: data.size });

				// Convert Blob to ArrayBuffer
				data
					.arrayBuffer()
					.then((buffer) => {
						logger().debug("converted blob to arraybuffer", {
							bufferLength: buffer.byteLength,
						});
						this.#parseBinaryMessage(new Uint8Array(buffer));
					})
					.catch((err) => {
						logger().error("error processing blob data", {
							error: err,
							errorMessage: err instanceof Error ? err.message : String(err),
							stack: err instanceof Error ? err.stack : undefined,
							blobSize: data.size,
						});
						this.#fireError(err);
					});
			}
		} catch (err) {
			logger().error("error sending websocket message", {
				error: err,
				errorMessage: err instanceof Error ? err.message : String(err),
				stack: err instanceof Error ? err.stack : undefined,
				dataType: typeof data,
				dataLength: typeof data === "string" ? data.length : "binary",
			});
			this.#fireError(err);
		}
	}

	/**
	 * Closes the connection
	 */
	close(code = 1000, reason = ""): void {
		if (this.readyState === this.CLOSED || this.readyState === this.CLOSING) {
			return;
		}

		logger().debug("closing fake websocket", { code, reason });

		this.#readyState = this.CLOSING;

		// Call the handler's onClose method
		this.#handler
			.onClose()
			.catch((err) => {
				logger().error("error closing websocket", { error: err });
			})
			.finally(() => {
				this.#readyState = this.CLOSED;

				// Fire the close event
				// Create a close event object since CloseEvent is not available in Node.js
				const closeEvent = {
					type: "close",
					wasClean: code === 1000,
					code,
					reason,
					target: this,
					currentTarget: this,
				} as unknown as CloseEvent;

				this.#fireClose(closeEvent);
			});
	}

	/**
	 * Initialize the connection with the handler
	 */
	async #initialize(): Promise<void> {
		try {
			logger().info("fake websocket initializing");

			// Call the handler's onOpen method
			logger().info("calling handler.onOpen with WSContext");
			await this.#handler.onOpen(this.#wsContext);

			// Update the ready state and fire events
			this.#readyState = this.OPEN;
			logger().info("fake websocket initialized and now OPEN");

			// Fire the open event
			this.#fireOpen();

			// Delay processing queued messages slightly to allow event handlers to be set up
			if (this.#queuedMessages.length > 0) {
				if (this.readyState !== this.OPEN) {
					logger().warn("socket no longer open, dropping queued messages");
					return;
				}

				logger().info(
					`now processing ${this.#queuedMessages.length} queued messages`,
				);

				// Create a copy to avoid issues if new messages arrive during processing
				const messagesToProcess = [...this.#queuedMessages];
				this.#queuedMessages = [];

				// Process each queued message
				for (const message of messagesToProcess) {
					logger().debug("processing queued message");
					this.#handleMessage(message);
				}
			}
		} catch (err) {
			logger().error("error opening fake websocket", {
				error: err,
				errorMessage: err instanceof Error ? err.message : String(err),
				stack: err instanceof Error ? err.stack : undefined,
			});
			this.#fireError(err);
			this.close(1011, "Internal error during initialization");
		}
	}

	/**
	 * Handle messages received from the server via the WSContext
	 */
	#handleMessage(data: string | ArrayBuffer | Uint8Array): void {
		// Store messages that arrive before the socket is fully initialized
		if (this.readyState !== this.OPEN) {
			logger().debug("message received before socket is OPEN, queuing", {
				readyState: this.readyState,
				dataType: typeof data,
				dataLength:
					typeof data === "string"
						? data.length
						: data instanceof ArrayBuffer
							? data.byteLength
							: data instanceof Uint8Array
								? data.byteLength
								: "unknown",
			});

			// Queue the message to be processed once the socket is open
			this.#queuedMessages.push(data);
			return;
		}

		// Log message received from server
		logger().debug("fake websocket received message from server", {
			dataType: typeof data,
			dataLength:
				typeof data === "string"
					? data.length
					: data instanceof ArrayBuffer
						? data.byteLength
						: data instanceof Uint8Array
							? data.byteLength
							: "unknown",
		});

		// Create a MessageEvent-like object
		const event = {
			type: "message",
			data,
			target: this,
			currentTarget: this,
		} as unknown as MessageEvent;

		// Dispatch the event
		if (this.onmessage) {
			logger().debug("dispatching message to onmessage handler");
			this.onmessage(event);
		} else {
			logger().debug("no onmessage handler registered, buffering message");
			this.#bufferedEvents.push({ type: "message", event });
		}
	}

	#handleClose(code: number, reason: string): void {
		if (this.readyState === this.CLOSED) return;

		this.#readyState = this.CLOSED;

		// Create a CloseEvent-like object
		const event = {
			type: "close",
			code,
			reason,
			wasClean: code === 1000,
			target: this,
			currentTarget: this,
		} as unknown as CloseEvent;

		// Dispatch the event
		if (this.onclose) {
			this.onclose(event);
		} else {
			this.#bufferedEvents.push({ type: "close", event });
		}
	}

	#flushBufferedEvents(type: "open" | "close" | "error" | "message"): void {
		const eventsToFlush = this.#bufferedEvents.filter(
			(buffered) => buffered.type === type,
		);
		this.#bufferedEvents = this.#bufferedEvents.filter(
			(buffered) => buffered.type !== type,
		);

		for (const { event } of eventsToFlush) {
			try {
				switch (type) {
					case "open":
						this.#onopen?.(event);
						break;
					case "close":
						this.#onclose?.(event);
						break;
					case "error":
						this.#onerror?.(event);
						break;
					case "message":
						this.#onmessage?.(event);
						break;
				}
			} catch (err) {
				logger().error(`error in buffered ${type} handler`, { error: err });
			}
		}
	}

	#fireOpen(): void {
		try {
			// Create an Event-like object since Event constructor may not be available
			const event = {
				type: "open",
				target: this,
				currentTarget: this,
			} as unknown as Event;

			if (this.onopen) {
				this.onopen(event);
			} else {
				this.#bufferedEvents.push({ type: "open", event });
			}
		} catch (err) {
			logger().error("error in onopen handler", { error: err });
		}
	}

	#fireClose(event: CloseEvent): void {
		try {
			if (this.onclose) {
				this.onclose(event);
			} else {
				this.#bufferedEvents.push({ type: "close", event });
			}
		} catch (err) {
			logger().error("error in onclose handler", { error: err });
		}
	}

	#fireError(error: unknown): void {
		try {
			// Create an Event-like object for error
			const event = {
				type: "error",
				target: this,
				currentTarget: this,
				error,
				message: error instanceof Error ? error.message : String(error),
			} as unknown as Event;

			if (this.onerror) {
				this.onerror(event);
			} else {
				this.#bufferedEvents.push({ type: "error", event });
			}
		} catch (err) {
			logger().error("error in onerror handler", { error: err });
		}

		// Log the error
		logger().error("websocket error", { error });
	}

	async #parseBinaryMessage(data: Uint8Array): Promise<void> {
		try {
			logger().debug("parsing binary message", { dataLength: data.byteLength });

			// Attempt to parse the binary message using the protocol's parse function
			const message = await parseMessage(data as unknown as InputData, {
				encoding: "cbor",
				maxIncomingMessageSize: 1024 * 1024, // 1MB default limit
			});

			// Forward the parsed message to the handler
			await this.#handler.onMessage(message);
			logger().debug("handler processed binary message");
		} catch (err) {
			logger().error("error parsing binary websocket message", {
				error: err,
				errorMessage: err instanceof Error ? err.message : String(err),
				stack: err instanceof Error ? err.stack : undefined,
				dataLength: data.byteLength,
			});
			this.#fireError(err);
		}
	}
}
