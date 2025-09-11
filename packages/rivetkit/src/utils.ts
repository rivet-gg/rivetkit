export { stringifyError } from "@/common/utils";
export { assertUnreachable } from "./common/utils";

import type { Context as HonoContext, Handler as HonoHandler } from "hono";

import pkgJson from "../package.json" with { type: "json" };

export const VERSION = pkgJson.version;

let _userAgent: string | undefined;

export function httpUserAgent(): string {
	// Return cached value if already initialized
	if (_userAgent !== undefined) {
		return _userAgent;
	}

	// Library
	let userAgent = `RivetKit/${VERSION}`;

	// Navigator
	const navigatorObj = typeof navigator !== "undefined" ? navigator : undefined;
	if (navigatorObj?.userAgent) userAgent += ` ${navigatorObj.userAgent}`;

	_userAgent = userAgent;

	return userAgent;
}

export type UpgradeWebSocket = (
	createEvents: (c: HonoContext) => any,
) => HonoHandler;

export function getEnvUniversal(key: string): string | undefined {
	if (typeof Deno !== "undefined") {
		return Deno.env.get(key);
	} else if (typeof process !== "undefined") {
		// Do this after Deno since `process` is sometimes polyfilled
		return process.env[key];
	}
}

export function dbg<T>(x: T): T {
	console.trace(`=== DEBUG ===\n${x}`);
	return x;
}

/**
 * Converts various ArrayBuffer-like types to Uint8Array.
 * Handles ArrayBuffer, ArrayBufferView (including typed arrays), and passes through existing Uint8Array.
 *
 * @param data - The ArrayBuffer or ArrayBufferView to convert
 * @returns A Uint8Array view of the data
 */
export function toUint8Array(data: ArrayBuffer | ArrayBufferView): Uint8Array {
	if (data instanceof Uint8Array) {
		return data;
	} else if (data instanceof ArrayBuffer) {
		return new Uint8Array(data);
	} else if (ArrayBuffer.isView(data)) {
		// Handle other ArrayBufferView types (Int8Array, Uint16Array, DataView, etc.)
		return new Uint8Array(
			data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
		);
	} else {
		throw new TypeError("Input must be ArrayBuffer or ArrayBufferView");
	}
}

// Long timeouts
//
// JavaScript timers use a signed 32-bit integer for delays, so values above 2^31-1 (~24.8 days)
// are not reliable and may fire immediately or overflow.
//
// https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout#maximum_delay_value
const TIMEOUT_MAX = 2147483647; // 2^31-1

export type LongTimeoutHandle = { abort: () => void };

export function setLongTimeout(
	listener: () => void,
	after: number,
): LongTimeoutHandle {
	let timeout: ReturnType<typeof setTimeout> | undefined;

	function start(remaining: number) {
		if (remaining <= TIMEOUT_MAX) {
			timeout = setTimeout(listener, remaining);
		} else {
			timeout = setTimeout(() => {
				start(remaining - TIMEOUT_MAX);
			}, TIMEOUT_MAX);
		}
	}

	start(after);

	return {
		abort: () => {
			if (timeout !== undefined) clearTimeout(timeout);
		},
	};
}

/**
 * A tiny utility that coalesces/enqueues async operations so only the latest
 * queued task runs per cycle, while callers receive a promise that resolves
 * when the task for the cycle they joined has completed.
 */
export class SinglePromiseQueue {
	/** Next operation to execute in the queue. If attempting to enqueue another op, it will override the existing op. */
	#queuedOp?: () => Promise<void>;

	/** The currently running promise of #drainLoop. Do not await this, instead await `pending` to await the current cycle. */
	runningDrainLoop?: Promise<void>;

	/** Pending resolver fro the currently queued entry. */
	#pending?: PromiseWithResolvers<void>;

	/** Queue the next operation and return a promise that resolves when it flushes. */
	enqueue(op: () => Promise<void>): Promise<void> {
		// Replace any previously queued operation with the latest one
		this.#queuedOp = op;

		// Ensure a shared resolver exists for all callers in this cycle
		if (!this.#pending) {
			this.#pending = Promise.withResolvers<void>();
		}

		const waitForThisCycle = this.#pending.promise;

		// Start runner if not already running
		if (!this.runningDrainLoop) {
			this.runningDrainLoop = this.#drainLoop();
		}

		return waitForThisCycle;
	}

	/** Drain queued operations sequentially until there is nothing left. */
	async #drainLoop(): Promise<void> {
		try {
			while (this.#queuedOp) {
				// Capture current cycle resolver then reset for the next cycle
				const resolver = this.#pending;
				this.#pending = undefined;

				// Capture and clear the currently queued operation
				const op = this.#queuedOp;
				this.#queuedOp = undefined;

				try {
					await op();
				} catch {
					// Swallow errors: callers only await cycle completion, not success
				}

				// Notify all waiters for this cycle
				resolver?.resolve();
			}
		} finally {
			this.runningDrainLoop = undefined;
		}
	}
}

export function bufferToArrayBuffer(buf: Buffer | Uint8Array): ArrayBuffer {
	return buf.buffer.slice(
		buf.byteOffset,
		buf.byteOffset + buf.byteLength,
	) as ArrayBuffer;
}
