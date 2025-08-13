import type { EventListener } from "eventsource";
import type { SSEStreamingApi } from "hono/streaming";
import { getLogger } from "@/common//log";
import type {
	UniversalEvent,
	UniversalEventSource,
	UniversalMessageEvent,
} from "@/common/eventsource-interface";

export const LOGGER_NAME = "fake-event-source";

export function logger() {
	return getLogger(LOGGER_NAME);
}

/**
 * FakeEventSource provides a minimal implementation of an SSE stream
 * that handles events for the inline client driver
 */
export class FakeEventSource implements UniversalEventSource {
	// EventSource readyState values
	readonly CONNECTING = 0 as const;
	readonly OPEN = 1 as const;
	readonly CLOSED = 2 as const;

	url = "http://internal-sse-endpoint";
	readyState: 0 | 1 | 2 = 1; // OPEN
	withCredentials = false;

	// Event handlers
	onopen: ((event: UniversalEvent) => void) | null = null;
	onmessage: ((event: UniversalMessageEvent) => void) | null = null;
	onerror: ((event: UniversalEvent) => void) | null = null;

	// Private event listeners
	#listeners: Record<string, Set<EventListener>> = {
		open: new Set(),
		message: new Set(),
		error: new Set(),
		close: new Set(),
	};

	// Stream that will be passed to the handler
	#stream: SSEStreamingApi;
	#onCloseCallback: () => Promise<void>;

	/**
	 * Creates a new FakeEventSource
	 */
	constructor(onCloseCallback: () => Promise<void>) {
		this.#onCloseCallback = onCloseCallback;

		this.#stream = this.#createStreamApi();

		// Trigger open event on next tick
		setTimeout(() => {
			if (this.readyState === 1) {
				this.#dispatchEvent("open");
			}
		}, 0);

		logger().debug("FakeEventSource created");
	}

	// Creates the SSE streaming API implementation
	#createStreamApi(): SSEStreamingApi {
		// Create self-reference for closures
		const self = this;

		const streamApi: SSEStreamingApi = {
			write: async (input) => {
				const data =
					typeof input === "string" ? input : new TextDecoder().decode(input);
				self.#dispatchEvent("message", { data });
				return streamApi;
			},

			writeln: async (input: string) => {
				await streamApi.write(input + "\n");
				return streamApi;
			},

			writeSSE: async (message: {
				data: string | Promise<string>;
				event?: string;
				id?: string;
				retry?: number;
			}): Promise<void> => {
				const data = await message.data;

				if (message.event) {
					self.#dispatchEvent(message.event, { data });
				} else {
					self.#dispatchEvent("message", { data });
				}
			},

			sleep: async (ms: number) => {
				await new Promise((resolve) => setTimeout(resolve, ms));
				return streamApi;
			},

			close: async () => {
				self.close();
			},

			pipe: async (_body: ReadableStream) => {
				// No-op implementation
			},

			onAbort: async (cb: () => void) => {
				self.addEventListener("error", () => {
					cb();
				});
				return streamApi;
			},

			abort: async () => {
				self.#dispatchEvent("error");
				return streamApi;
			},

			// Additional required properties
			get responseReadable() {
				return null as unknown as ReadableStream;
			},

			get aborted() {
				return self.readyState === 2; // CLOSED
			},

			get closed() {
				return self.readyState === 2; // CLOSED
			},
		};

		return streamApi;
	}

	/**
	 * Closes the connection
	 */
	close(): void {
		if (this.readyState === 2) {
			// CLOSED
			return;
		}

		logger().debug("closing FakeEventSource");
		this.readyState = 2; // CLOSED

		// Call the close callback
		this.#onCloseCallback().catch((err) => {
			logger().error("error in onClose callback", { error: err });
		});

		// Dispatch close event
		this.#dispatchEvent("close");
	}

	/**
	 * Get the stream API to pass to the handler
	 */
	getStream(): SSEStreamingApi {
		return this.#stream;
	}

	// Implementation of EventTarget-like interface
	addEventListener(type: string, listener: EventListener): void {
		if (!this.#listeners[type]) {
			this.#listeners[type] = new Set();
		}
		this.#listeners[type].add(listener);
	}

	removeEventListener(type: string, listener: EventListener): void {
		if (this.#listeners[type]) {
			this.#listeners[type].delete(listener);
		}
	}

	dispatchEvent(event: UniversalEvent): boolean {
		this.#dispatchEvent(event.type, event);
		return true;
	}

	// Internal method to dispatch events
	#dispatchEvent(type: string, detail?: Record<string, any>): void {
		// Create appropriate event object
		let event: any;
		if (type === "message") {
			event = {
				type: "message",
				target: this,
				data: detail?.data || "",
				origin: "",
				lastEventId: "",
			};
		} else if (type === "close") {
			event = {
				type: "close",
				target: this,
				code: detail?.code || 1000,
				reason: detail?.reason || "",
				wasClean: detail?.wasClean ?? true,
			};
		} else if (type === "error") {
			event = {
				type: "error",
				target: this,
				error: detail?.error,
			};
		} else {
			event = {
				type: type,
				target: this,
			};
		}

		// Call all listeners first
		if (this.#listeners[type]) {
			for (const listener of this.#listeners[type]) {
				try {
					listener.call(this, event);
				} catch (err) {
					logger().error(`error in ${type} event listener`, { error: err });
				}
			}
		}

		// Then call specific handler
		switch (type) {
			case "open":
				if (this.onopen) {
					try {
						this.onopen.call(this as any, event);
					} catch (err) {
						logger().error("error in onopen handler", { error: err });
					}
				}
				break;
			case "message":
				if (this.onmessage) {
					try {
						this.onmessage.call(this as any, event);
					} catch (err) {
						logger().error("error in onmessage handler", { error: err });
					}
				}
				break;
			case "error":
				if (this.onerror) {
					try {
						this.onerror.call(this as any, event);
					} catch (err) {
						logger().error("error in onerror handler", { error: err });
					}
				}
				break;
			case "close":
				// Note: EventSource doesn't have onclose in the standard API
				// but we handle it here for consistency
				break;
		}
	}
}
