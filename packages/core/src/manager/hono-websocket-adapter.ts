import type { WSContext } from "hono/ws";
import type {
	RivetCloseEvent,
	RivetEvent,
	RivetMessageEvent,
	UniversalWebSocket,
} from "@/common/websocket-interface";
import { logger } from "./log";

/**
 * HonoWebSocketAdapter provides a WebSocket-like interface over WSContext
 * for raw WebSocket handling in actors
 */
export class HonoWebSocketAdapter implements UniversalWebSocket {
	// WebSocket readyState values
	readonly CONNECTING = 0 as const;
	readonly OPEN = 1 as const;
	readonly CLOSING = 2 as const;
	readonly CLOSED = 3 as const;

	#ws: WSContext;
	#readyState: 0 | 1 | 2 | 3 = 1; // Start as OPEN since WSContext is already connected
	#eventListeners: Map<string, Set<(event: any) => void>> = new Map();
	#closeCode?: number;
	#closeReason?: string;

	constructor(ws: WSContext) {
		this.#ws = ws;

		// The WSContext is already open when we receive it
		this.#readyState = this.OPEN;

		// Immediately fire the open event
		setTimeout(() => {
			this.#fireEvent("open", { type: "open", target: this });
		}, 0);
	}

	get readyState(): 0 | 1 | 2 | 3 {
		return this.#readyState;
	}

	get binaryType(): "arraybuffer" | "blob" {
		return "arraybuffer";
	}

	set binaryType(value: "arraybuffer" | "blob") {
		// Ignored for now - always use arraybuffer
	}

	get bufferedAmount(): number {
		return 0; // Not tracked in WSContext
	}

	get extensions(): string {
		return ""; // Not available in WSContext
	}

	get protocol(): string {
		return ""; // Not available in WSContext
	}

	get url(): string {
		return ""; // Not available in WSContext
	}

	send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
		if (this.readyState !== this.OPEN) {
			throw new Error("WebSocket is not open");
		}

		try {
			logger().debug("bridge sending data", {
				dataType: typeof data,
				isString: typeof data === "string",
				isArrayBuffer: data instanceof ArrayBuffer,
				dataStr:
					typeof data === "string" ? data.substring(0, 100) : "<non-string>",
			});

			if (typeof data === "string") {
				this.#ws.send(data);
			} else if (data instanceof ArrayBuffer) {
				this.#ws.send(data);
			} else if (ArrayBuffer.isView(data)) {
				// Convert ArrayBufferView to ArrayBuffer
				const buffer = data.buffer.slice(
					data.byteOffset,
					data.byteOffset + data.byteLength,
				);
				// Check if it's a SharedArrayBuffer and convert to ArrayBuffer
				if (buffer instanceof SharedArrayBuffer) {
					const arrayBuffer = new ArrayBuffer(buffer.byteLength);
					new Uint8Array(arrayBuffer).set(new Uint8Array(buffer));
					this.#ws.send(arrayBuffer);
				} else {
					this.#ws.send(buffer);
				}
			} else if (data instanceof Blob) {
				// Convert Blob to ArrayBuffer
				data
					.arrayBuffer()
					.then((buffer) => {
						this.#ws.send(buffer);
					})
					.catch((error) => {
						logger().error("failed to convert blob to arraybuffer", { error });
						this.#fireEvent("error", { type: "error", target: this, error });
					});
			} else {
				// Try to convert to string as a fallback
				logger().warn("unsupported data type, converting to string", {
					dataType: typeof data,
					data,
				});
				this.#ws.send(String(data));
			}
		} catch (error) {
			logger().error("error sending websocket data", { error });
			this.#fireEvent("error", { type: "error", target: this, error });
			throw error;
		}
	}

	close(code = 1000, reason = ""): void {
		if (this.readyState === this.CLOSING || this.readyState === this.CLOSED) {
			return;
		}

		this.#readyState = this.CLOSING;
		this.#closeCode = code;
		this.#closeReason = reason;

		try {
			this.#ws.close(code, reason);

			// Update state and fire close event
			this.#readyState = this.CLOSED;
			this.#fireEvent("close", {
				type: "close",
				target: this,
				code,
				reason,
				wasClean: code === 1000,
			});
		} catch (error) {
			logger().error("error closing websocket", { error });
			this.#readyState = this.CLOSED;
			this.#fireEvent("close", {
				type: "close",
				target: this,
				code: 1006,
				reason: "Abnormal closure",
				wasClean: false,
			});
		}
	}

	addEventListener(type: string, listener: (event: any) => void): void {
		if (!this.#eventListeners.has(type)) {
			this.#eventListeners.set(type, new Set());
		}
		this.#eventListeners.get(type)!.add(listener);
	}

	removeEventListener(type: string, listener: (event: any) => void): void {
		const listeners = this.#eventListeners.get(type);
		if (listeners) {
			listeners.delete(listener);
		}
	}

	dispatchEvent(event: RivetEvent): boolean {
		const listeners = this.#eventListeners.get(event.type);
		if (listeners) {
			for (const listener of listeners) {
				try {
					listener(event);
				} catch (error) {
					logger().error(`error in ${event.type} event listener`, { error });
				}
			}
		}
		return true;
	}

	// Internal method to handle incoming messages from WSContext
	_handleMessage(data: string | ArrayBuffer): void {
		// Hono passes MessageEvent-like objects
		let actualData = data;
		if (data && typeof data === "object" && data !== null) {
			// Try to extract data from MessageEvent-like object
			if ("data" in data) {
				actualData = (data as any).data;
			} else if (data.toString() !== "[object Object]") {
				// If it has a meaningful toString, use that
				actualData = data.toString();
			}
		}

		logger().debug("bridge handling message", {
			dataType: typeof actualData,
			isArrayBuffer: actualData instanceof ArrayBuffer,
			dataStr: typeof actualData === "string" ? actualData : "<binary>",
		});

		this.#fireEvent("message", {
			type: "message",
			target: this,
			data: actualData,
		});
	}

	// Internal method to handle close from WSContext
	_handleClose(code: number, reason: string): void {
		if (this.readyState === this.CLOSED) return;

		this.#readyState = this.CLOSED;
		this.#closeCode = code;
		this.#closeReason = reason;

		this.#fireEvent("close", {
			type: "close",
			target: this,
			code,
			reason,
			wasClean: code === 1000,
		});
	}

	// Internal method to handle errors from WSContext
	_handleError(error: any): void {
		this.#fireEvent("error", {
			type: "error",
			target: this,
			error,
		});
	}

	#fireEvent(type: string, event: any): void {
		const listeners = this.#eventListeners.get(type);
		if (listeners) {
			for (const listener of listeners) {
				try {
					listener(event);
				} catch (error) {
					logger().error(`error in ${type} event listener`, { error });
				}
			}
		}

		// Also check for on* properties
		switch (type) {
			case "open":
				if (this.#onopen) {
					try {
						this.#onopen(event);
					} catch (error) {
						logger().error("error in onopen handler", { error });
					}
				}
				break;
			case "close":
				if (this.#onclose) {
					try {
						this.#onclose(event);
					} catch (error) {
						logger().error("error in onclose handler", { error });
					}
				}
				break;
			case "error":
				if (this.#onerror) {
					try {
						this.#onerror(event);
					} catch (error) {
						logger().error("error in onerror handler", { error });
					}
				}
				break;
			case "message":
				if (this.#onmessage) {
					try {
						this.#onmessage(event);
					} catch (error) {
						logger().error("error in onmessage handler", { error });
					}
				}
				break;
		}
	}

	// Event handler properties with getters/setters
	#onopen: ((event: RivetEvent) => void) | null = null;
	#onclose: ((event: RivetCloseEvent) => void) | null = null;
	#onerror: ((event: RivetEvent) => void) | null = null;
	#onmessage: ((event: RivetMessageEvent) => void) | null = null;

	get onopen(): ((event: RivetEvent) => void) | null {
		return this.#onopen;
	}
	set onopen(handler: ((event: RivetEvent) => void) | null) {
		this.#onopen = handler;
	}

	get onclose(): ((event: RivetCloseEvent) => void) | null {
		return this.#onclose;
	}
	set onclose(handler: ((event: RivetCloseEvent) => void) | null) {
		this.#onclose = handler;
	}

	get onerror(): ((event: RivetEvent) => void) | null {
		return this.#onerror;
	}
	set onerror(handler: ((event: RivetEvent) => void) | null) {
		this.#onerror = handler;
	}

	get onmessage(): ((event: RivetMessageEvent) => void) | null {
		return this.#onmessage;
	}
	set onmessage(handler: ((event: RivetMessageEvent) => void) | null) {
		this.#onmessage = handler;
	}
}
