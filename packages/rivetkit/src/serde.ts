import * as cbor from "cbor-x";
import invariant from "invariant";
import { assertUnreachable } from "@/common/utils";
import type { VersionedDataHandler } from "@/common/versioned-data";
import type { Encoding } from "@/mod";
import { jsonStringifyCompat } from "./actor/protocol/serde";

export function encodingIsBinary(encoding: Encoding): boolean {
	if (encoding === "json") {
		return false;
	} else if (encoding === "cbor" || encoding === "bare") {
		return true;
	} else {
		assertUnreachable(encoding);
	}
}

export function contentTypeForEncoding(encoding: Encoding): string {
	if (encoding === "json") {
		return "application/json";
	} else if (encoding === "cbor" || encoding === "bare") {
		return "application/octet-stream";
	} else {
		assertUnreachable(encoding);
	}
}

export function wsBinaryTypeForEncoding(
	encoding: Encoding,
): "arraybuffer" | "blob" {
	if (encoding === "json") {
		return "blob";
	} else if (encoding === "cbor" || encoding === "bare") {
		return "arraybuffer";
	} else {
		assertUnreachable(encoding);
	}
}

export function serializeWithEncoding<T>(
	encoding: Encoding,
	value: T,
	versionedDataHandler: VersionedDataHandler<T>,
): Uint8Array | string {
	if (encoding === "json") {
		return jsonStringifyCompat(value);
	} else if (encoding === "cbor") {
		return cbor.encode(value);
	} else if (encoding === "bare") {
		return versionedDataHandler.serializeWithEmbeddedVersion(value);
	} else {
		assertUnreachable(encoding);
	}
}

export function deserializeWithEncoding<T>(
	encoding: Encoding,
	buffer: Uint8Array | string,
	versionedDataHandler: VersionedDataHandler<T>,
): T {
	if (encoding === "json") {
		if (typeof buffer === "string") {
			return JSON.parse(buffer);
		} else {
			const decoder = new TextDecoder("utf-8");
			const jsonString = decoder.decode(buffer);
			return JSON.parse(jsonString);
		}
	} else if (encoding === "cbor") {
		invariant(
			typeof buffer !== "string",
			"buffer cannot be string for cbor encoding",
		);
		return cbor.decode(buffer);
	} else if (encoding === "bare") {
		invariant(
			typeof buffer !== "string",
			"buffer cannot be string for bare encoding",
		);
		return versionedDataHandler.deserializeWithEmbeddedVersion(buffer);
	} else {
		assertUnreachable(encoding);
	}
}
