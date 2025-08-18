import * as cbor from "cbor-x";
import { z } from "zod";
import * as errors from "@/actor/errors";
import { logger } from "../log";
import { assertUnreachable } from "../utils";

/** Data that can be deserialized. */
export type InputData = string | Buffer | Blob | ArrayBufferLike | Uint8Array;

/** Data that's been serialized. */
export type OutputData = string | Uint8Array;

export const EncodingSchema = z.enum(["json", "cbor"]);

/**
 * Encoding used to communicate between the client & actor.
 */
export type Encoding = z.infer<typeof EncodingSchema>;

export const SubscriptionsListSchema = z.array(z.string());
export type SubscriptionsList = z.infer<typeof SubscriptionsListSchema>;

/**
 * Helper class that helps serialize data without re-serializing for the same encoding.
 */
export class CachedSerializer<T> {
	#data: T;
	#cache = new Map<Encoding, OutputData>();

	constructor(data: T) {
		this.#data = data;
	}

	public get rawData(): T {
		return this.#data;
	}

	public serialize(encoding: Encoding): OutputData {
		const cached = this.#cache.get(encoding);
		if (cached) {
			return cached;
		} else {
			const serialized = serialize(this.#data, encoding);
			this.#cache.set(encoding, serialized);
			return serialized;
		}
	}
}

/**
 * Use `CachedSerializer` if serializing the same data repeatedly.
 */
export function serialize<T>(value: T, encoding: Encoding): OutputData {
	if (encoding === "json") {
		return JSON.stringify(value);
	} else if (encoding === "cbor") {
		// TODO: Remove this hack, but cbor-x can't handle anything extra in data structures
		const cleanValue = JSON.parse(JSON.stringify(value));
		return cbor.encode(cleanValue);
	} else {
		assertUnreachable(encoding);
	}
}

export async function deserialize(data: InputData, encoding: Encoding) {
	if (encoding === "json") {
		if (typeof data !== "string") {
			logger().warn("received non-string for json parse");
			throw new errors.MalformedMessage();
		} else {
			return JSON.parse(data);
		}
	} else if (encoding === "cbor") {
		if (data instanceof Blob) {
			const arrayBuffer = await data.arrayBuffer();
			return cbor.decode(new Uint8Array(arrayBuffer));
		} else if (data instanceof Uint8Array) {
			return cbor.decode(data);
		} else if (
			data instanceof ArrayBuffer ||
			data instanceof SharedArrayBuffer
		) {
			return cbor.decode(new Uint8Array(data));
		} else {
			logger().warn("received non-binary type for cbor parse");
			throw new errors.MalformedMessage();
		}
	} else {
		assertUnreachable(encoding);
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

/** Converts data that was encoded to a string. Some formats (like SSE) don't support raw binary data. */
export function encodeDataToString(message: OutputData): string {
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
