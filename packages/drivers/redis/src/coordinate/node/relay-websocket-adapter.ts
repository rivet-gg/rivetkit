import { toUint8Array } from "@rivetkit/core";
import { logger } from "../log";
import type { RelayConn } from "../relay-conn";
import { LeaderChangedError } from "./message";
import type { Node } from "./mod";
import type { NodeMessage } from "./protocol";

export class RelayWebSocketAdapter implements WebSocket {
	#node: Node;
	#websocketId: string;
	#relayConn: RelayConn;
	#readyState: number = WebSocket.CONNECTING;
	#eventListeners: Map<string, Set<(event: any) => void>> = new Map();
	#onopen: ((this: WebSocket, ev: Event) => any) | null = null;
	#onclose: ((this: WebSocket, ev: any) => any) | null = null;
	#onerror: ((this: WebSocket, ev: Event) => any) | null = null;
	#onmessage: ((this: WebSocket, ev: MessageEvent) => any) | null = null;
	#bufferedAmount = 0;
	#binaryType: "blob" | "arraybuffer" = "blob";
	#extensions = "";
	#protocol = "";
	#url = "";
	#openPromise: Promise<void>;
	#openResolve!: () => void;
	// Event buffering is needed since events can be fired
	// before JavaScript has a chance to add event listeners (e.g. within the same tick)
	#bufferedEvents: Array<{
		type: string;
		event: any;
	}> = [];

	constructor(node: Node, websocketId: string, relayConn: RelayConn) {
		this.#node = node;
		this.#websocketId = websocketId;
		this.#relayConn = relayConn;

		// Create open promise
		this.#openPromise = new Promise<void>((resolve) => {
			this.#openResolve = resolve;
		});

		// Register this WebSocket with the global state
		(this.#node.globalState as any).relayWebSockets =
			(this.#node.globalState as any).relayWebSockets || new Map();
		(this.#node.globalState as any).relayWebSockets.set(websocketId, this);

		logger().debug("relay websocket adapter registered", {
			websocketId,
			nodeId: (this.#node.globalState as any).nodeId,
			relayWebSocketsSize: (this.#node.globalState as any).relayWebSockets.size,
		});
	}

	get openPromise(): Promise<void> {
		return this.#openPromise;
	}

	get readyState(): number {
		return this.#readyState;
	}

	get bufferedAmount(): number {
		return this.#bufferedAmount;
	}

	get binaryType(): "blob" | "arraybuffer" {
		return this.#binaryType;
	}

	set binaryType(value: "blob" | "arraybuffer") {
		this.#binaryType = value;
	}

	get extensions(): string {
		return this.#extensions;
	}

	get protocol(): string {
		return this.#protocol;
	}

	get url(): string {
		return this.#url;
	}

	get actorId(): string {
		return this.#relayConn.actorId;
	}

	get onopen(): ((this: WebSocket, ev: Event) => any) | null {
		return this.#onopen;
	}

	set onopen(value: ((this: WebSocket, ev: Event) => any) | null) {
		this.#onopen = value;
		// Flush any buffered open events when onopen is set
		if (value) {
			this.#flushBufferedEvents("open");
		}
	}

	get onclose(): ((this: WebSocket, ev: any) => any) | null {
		return this.#onclose;
	}

	set onclose(value: ((this: WebSocket, ev: any) => any) | null) {
		this.#onclose = value;
		// Flush any buffered close events when onclose is set
		if (value) {
			this.#flushBufferedEvents("close");
		}
	}

	get onerror(): ((this: WebSocket, ev: Event) => any) | null {
		return this.#onerror;
	}

	set onerror(value: ((this: WebSocket, ev: Event) => any) | null) {
		this.#onerror = value;
		// Flush any buffered error events when onerror is set
		if (value) {
			this.#flushBufferedEvents("error");
		}
	}

	get onmessage(): ((this: WebSocket, ev: MessageEvent) => any) | null {
		return this.#onmessage;
	}

	set onmessage(value: ((this: WebSocket, ev: MessageEvent) => any) | null) {
		this.#onmessage = value;
		// Flush any buffered message events when onmessage is set
		if (value) {
			this.#flushBufferedEvents("message");
		}
	}

	send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
		if (this.#readyState !== WebSocket.OPEN) {
			throw new DOMException("WebSocket is not open");
		}

		// Convert data to appropriate format
		let isBinary = false;
		let messageData: string | Uint8Array;

		if (typeof data === "string") {
			messageData = data;
		} else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
			isBinary = true;
			messageData = toUint8Array(data);
		} else if (data instanceof Blob) {
			throw new Error("Blob sending not implemented in relay adapter");
		} else {
			throw new Error("Invalid data type");
		}

		// Send message to leader using no-retry version
		const message: NodeMessage = {
			b: {
				lwm: {
					wi: this.#websocketId,
					data: messageData,
					binary: isBinary,
				},
			},
		};
		this.#relayConn
			.publishMessageToleader(message, false)
			.catch((error: unknown) => {
				// Handle leader change by closing the WebSocket
				if (error instanceof LeaderChangedError) {
					this._handleClose(1001, "Actor leader changed");
				} else {
					const event = new Event("error");
					this.#fireEvent("error", event);
				}
			});
	}

	close(code?: number, reason?: string): void {
		if (
			this.#readyState === WebSocket.CLOSING ||
			this.#readyState === WebSocket.CLOSED
		) {
			return;
		}

		this.#readyState = WebSocket.CLOSING;

		// Send close message to leader
		this.#relayConn
			.disconnect(false, "Client closed WebSocket", {
				b: {
					lwc: {
						wi: this.#websocketId,
						code,
						reason,
					},
				},
			})
			.finally(() => {
				this.#readyState = WebSocket.CLOSED;
				(this.#node.globalState as any).relayWebSockets?.delete(
					this.#websocketId,
				);

				const event = {
					type: "close",
					target: this,
					code: code || 1000,
					reason: reason || "",
					wasClean: true,
				};
				this.#fireEvent("close", event);
			});
	}

	addEventListener(type: string, listener: any, options?: boolean | any): void {
		if (typeof listener === "function") {
			let listeners = this.#eventListeners.get(type);
			if (!listeners) {
				listeners = new Set();
				this.#eventListeners.set(type, listeners);
			}
			listeners.add(listener);

			// Flush any buffered events for this type
			logger().debug(`flushing buffered events for ${type}`, {
				websocketId: this.#websocketId,
				bufferedEventsCount: this.#bufferedEvents.filter((e) => e.type === type)
					.length,
			});
			this.#flushBufferedEvents(type);
		}
	}

	removeEventListener(
		type: string,
		listener: any,
		options?: boolean | any,
	): void {
		if (typeof listener === "function") {
			const listeners = this.#eventListeners.get(type);
			if (listeners) {
				listeners.delete(listener);
			}
		}
	}

	dispatchEvent(event: Event): boolean {
		// Simple implementation
		return true;
	}

	#fireEvent(type: string, event: any): void {
		// Call all registered event listeners
		const listeners = this.#eventListeners.get(type);
		let hasListeners = false;

		if (listeners && listeners.size > 0) {
			hasListeners = true;
			for (const listener of listeners) {
				try {
					listener.call(this, event);
				} catch (error) {
					logger().error("error in websocket event listener", { error, type });
				}
			}
		}

		// Call the onX property if set
		switch (type) {
			case "open":
				if (this.#onopen) {
					hasListeners = true;
					try {
						this.#onopen.call(this, event);
					} catch (error) {
						logger().error("error in onopen handler", { error });
					}
				}
				break;
			case "close":
				if (this.#onclose) {
					hasListeners = true;
					try {
						this.#onclose.call(this, event);
					} catch (error) {
						logger().error("error in onclose handler", { error });
					}
				}
				break;
			case "error":
				if (this.#onerror) {
					hasListeners = true;
					try {
						this.#onerror.call(this, event);
					} catch (error) {
						logger().error("error in onerror handler", { error });
					}
				}
				break;
			case "message":
				if (this.#onmessage) {
					hasListeners = true;
					try {
						this.#onmessage.call(this, event);
					} catch (error) {
						logger().error("error in onmessage handler", { error });
					}
				}
				break;
		}

		// Buffer the event if no listeners are registered
		if (!hasListeners) {
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
			// Re-fire the event, which will now have listeners
			const listeners = this.#eventListeners.get(type);
			if (listeners) {
				for (const listener of listeners) {
					try {
						listener.call(this, event);
					} catch (error) {
						logger().error("error in websocket event listener", {
							error,
							type,
						});
					}
				}
			}
		}
	}

	// Internal method to handle incoming messages from leader
	_handleMessage(data: string | Uint8Array, isBinary: boolean): void {
		if (this.#readyState !== WebSocket.OPEN) {
			return;
		}

		let messageData: Uint8Array | string;
		if (isBinary) {
			// Handle binary data - should always be Uint8Array
			if (data instanceof Uint8Array) {
				messageData = data;
			} else {
				throw new Error("Binary data must be Uint8Array");
			}
		} else {
			messageData = data;
		}

		const event = new MessageEvent("message", {
			data: messageData,
			origin: "",
			lastEventId: "",
		});

		this.#fireEvent("message", event);
	}

	// Internal method to handle open confirmation from leader
	_handleOpen(): void {
		logger().debug("_handleOpen called", {
			websocketId: this.#websocketId,
			currentReadyState: this.#readyState,
			isConnecting: this.#readyState === WebSocket.CONNECTING,
		});

		if (this.#readyState !== WebSocket.CONNECTING) {
			return;
		}

		this.#readyState = WebSocket.OPEN;
		this.#openResolve();
		const event = new Event("open");
		this.#fireEvent("open", event);
	}

	// Internal method to handle close from leader
	_handleClose(code?: number, reason?: string): void {
		if (this.#readyState === WebSocket.CLOSED) {
			return;
		}

		this.#readyState = WebSocket.CLOSED;
		(this.#node.globalState as any).relayWebSockets?.delete(this.#websocketId);

		const event = {
			type: "close",
			target: this,
			code: code || 1000,
			reason: reason || "",
			wasClean: true,
		};
		this.#fireEvent("close", event);
	}

	// Required WebSocket constants
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;

	// Instance constants
	readonly CONNECTING = 0;
	readonly OPEN = 1;
	readonly CLOSING = 2;
	readonly CLOSED = 3;
}
