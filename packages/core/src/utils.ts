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
