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
	// Event buffering is needed since events can be fired
	// before JavaScript has a chance to add event listeners (e.g. within the same tick)
	#bufferedEvents: Array<{
		type: string;
		event: any;
	}> = [];

	// Event listeners with buffering
	#eventListeners: Map<string, ((ev: any) => void)[]> = new Map();

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
		this.#dispatchEvent("message", event);
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
		this.#dispatchEvent("close", event);
	}

	addEventListener(type: string, listener: (ev: any) => void): void {
		if (!this.#eventListeners.has(type)) {
			this.#eventListeners.set(type, []);
		}
		this.#eventListeners.get(type)!.push(listener);
		
		// Flush any buffered events for this type
		this.#flushBufferedEvents(type);
	}

	removeEventListener(type: string, listener: (ev: any) => void): void {
		const listeners = this.#eventListeners.get(type);
		if (listeners) {
			const index = listeners.indexOf(listener);
			if (index !== -1) {
				listeners.splice(index, 1);
			}
		}
	}

	#dispatchEvent(type: string, event: any): void {
		const listeners = this.#eventListeners.get(type);
		if (listeners && listeners.length > 0) {
			logger().debug(`dispatching ${type} event to ${listeners.length} listeners`);
			for (const listener of listeners) {
				try {
					listener(event);
				} catch (err) {
					logger().error(`error in ${type} event listener`, { error: err });
				}
			}
		} else {
			logger().debug(`no ${type} listeners registered, buffering event`);
			this.#bufferedEvents.push({ type, event });
		}
	}

	#flushBufferedEvents(type: string): void {
		const eventsToFlush = this.#bufferedEvents.filter(
			(buffered) => buffered.type === type,
		);
		this.#bufferedEvents = this.#bufferedEvents.filter(
			(buffered) => buffered.type !== type,
		);

		for (const { event } of eventsToFlush) {
			this.#dispatchEvent(type, event);
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

			this.#dispatchEvent("open", event);
		} catch (err) {
			logger().error("error in open event", { error: err });
		}
	}

	#fireClose(event: CloseEvent): void {
		try {
			this.#dispatchEvent("close", event);
		} catch (err) {
			logger().error("error in close event", { error: err });
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

			this.#dispatchEvent("error", event);
		} catch (err) {
			logger().error("error in error event", { error: err });
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
