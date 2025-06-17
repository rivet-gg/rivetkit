import { WSContext } from "hono/ws";
import { logger } from "@/registry/log";
import type { ConnectWebSocketOutput } from "@/worker/router-endpoints";
import type * as messageToServer from "@/worker/protocol/message/to-server";
import { parseMessage } from "@/worker/protocol/message/mod";
import type { InputData } from "@/worker/protocol/serde";

/**
 * FakeWebSocket implements a WebSocket-like interface
 * that connects to a ConnectWebSocketOutput handler
 */
export class FakeWebSocket implements WebSocket {
	// WebSocket interface properties
	binaryType: BinaryType = "arraybuffer";
	bufferedAmount: number = 0;
	extensions: string = "";
	protocol: string = "";
	url: string = "";

	// Event handlers
	onclose: ((ev: CloseEvent) => any) | null = null;
	onerror: ((ev: Event) => any) | null = null;
	onmessage: ((ev: MessageEvent) => any) | null = null;
	onopen: ((ev: Event) => any) | null = null;

	// WebSocket readyState values
	readonly CONNECTING = 0 as const;
	readonly OPEN = 1 as const;
	readonly CLOSING = 2 as const;
	readonly CLOSED = 3 as const;

	// Private properties
	#handler: ConnectWebSocketOutput;
	#wsContext: WSContext;
	#readyState: 0 | 1 | 2 | 3 = 0; // Start in CONNECTING state
	#initPromise: Promise<void>;
	#initResolve: (value: void) => void;
	#initReject: (reason: any) => void;
	#queuedMessages: Array<string | ArrayBuffer | Uint8Array> = [];

	/**
	 * Creates a new FakeWebSocket connected to a ConnectWebSocketOutput handler
	 */
	constructor(handler: ConnectWebSocketOutput) {
		this.#handler = handler;

		// Create promise resolvers for initialization
		const initPromise = Promise.withResolvers<void>();
		this.#initPromise = initPromise.promise;
		this.#initResolve = initPromise.resolve;
		this.#initReject = initPromise.reject;

		// Create a fake WSContext to pass to the handler
		this.#wsContext = new WSContext({
			send: (data: string | ArrayBuffer | Uint8Array) => {
				logger().debug("WSContext.send called", {
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
				this.#handleMessage(data);
			},
			close: (code?: number, reason?: string) => {
				logger().debug("WSContext.close called", { code, reason });
				this.#handleClose(code || 1000, reason || "");
			},
			// Set readyState to 1 (OPEN) since handlers expect an open connection
			readyState: 1,
			url: "ws://fake-websocket/",
			protocol: "",
		});

		// Initialize the connection
		this.#initialize();
	}

	/**
	 * Returns the current ready state of the connection
	 */
	get readyState(): 0 | 1 | 2 | 3 {
		return this.#readyState;
	}

	/**
	 * Sends data through the connection
	 */
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

				logger().debug("fake websocket sending message", {
					messageType:
						message.b &&
						("i" in message.b
							? "init"
							: "ar" in message.b
								? "action"
								: "sr" in message.b
									? "subscription"
									: "unknown"),
				});

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
	 * Implementation of EventTarget methods (minimal implementation)
	 */
	addEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject,
	): void {
		// Map to the onXXX properties
		switch (type) {
			case "open":
				this.onopen =
					typeof listener === "function"
						? listener
						: (ev) => listener.handleEvent(ev);
				break;
			case "message":
				this.onmessage =
					typeof listener === "function"
						? listener
						: (ev) => listener.handleEvent(ev);
				break;
			case "close":
				this.onclose =
					typeof listener === "function"
						? listener
						: (ev) => listener.handleEvent(ev);
				break;
			case "error":
				this.onerror =
					typeof listener === "function"
						? listener
						: (ev) => listener.handleEvent(ev);
				break;
		}
	}

	removeEventListener(type: string): void {
		// Simple implementation that just nullifies the corresponding handler
		switch (type) {
			case "open":
				this.onopen = null;
				break;
			case "message":
				this.onmessage = null;
				break;
			case "close":
				this.onclose = null;
				break;
			case "error":
				this.onerror = null;
				break;
		}
	}

	dispatchEvent(event: Event): boolean {
		// Dispatch to the corresponding handler
		switch (event.type) {
			case "open":
				if (this.onopen) this.onopen(event);
				break;
			case "message":
				if (this.onmessage) this.onmessage(event as MessageEvent);
				break;
			case "close":
				if (this.onclose) this.onclose(event as CloseEvent);
				break;
			case "error":
				if (this.onerror) this.onerror(event);
				break;
		}
		return !event.defaultPrevented;
	}

	/**
	 * Wait for the WebSocket to be initialized and ready
	 */
	waitForReady(): Promise<void> {
		return this.#initPromise;
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

			// Resolve the initialization promise - do this BEFORE processing queued messages
			// This allows clients to set up their event handlers before messages are processed
			logger().info("resolving initialization promise");
			this.#initResolve();

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
			this.#initReject(err);
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
			logger().warn("no onmessage handler registered, message dropped");
		}
	}

	/**
	 * Handle connection close from the server side
	 */
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
		}
	}

	/**
	 * Fire the open event
	 */
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
			}
		} catch (err) {
			logger().error("error in onopen handler", { error: err });
		}
	}

	/**
	 * Fire the close event
	 */
	#fireClose(event: CloseEvent): void {
		try {
			if (this.onclose) {
				this.onclose(event);
			}
		} catch (err) {
			logger().error("error in onclose handler", { error: err });
		}
	}

	/**
	 * Fire the error event
	 */
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
			}
		} catch (err) {
			logger().error("error in onerror handler", { error: err });
		}

		// Log the error
		logger().error("websocket error", { error });
	}

	/**
	 * Parse binary message and forward to handler
	 */
	async #parseBinaryMessage(data: Uint8Array): Promise<void> {
		try {
			logger().debug("parsing binary message", { dataLength: data.byteLength });

			// Attempt to parse the binary message using the protocol's parse function
			const message = await parseMessage(data as unknown as InputData, {
				encoding: "cbor",
				maxIncomingMessageSize: 1024 * 1024, // 1MB default limit
			});

			logger().debug("successfully parsed binary message", {
				messageType:
					message.b &&
					("i" in message.b
						? "init"
						: "ar" in message.b
							? "action"
							: "sr" in message.b
								? "subscription"
								: "unknown"),
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
