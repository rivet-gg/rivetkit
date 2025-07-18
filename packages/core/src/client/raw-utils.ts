import type { Encoding } from "@/actor/protocol/serde";
import { assertUnreachable } from "@/common/utils";
import type { ActorQuery } from "@/manager/protocol/query";
import type { ClientDriver } from "./client";

/**
 * Shared implementation for raw HTTP fetch requests
 */
export async function rawHttpFetch(
	driver: ClientDriver,
	actorQuery: ActorQuery,
	encodingKind: Encoding,
	params: unknown,
	input: string | URL | Request,
	init?: RequestInit,
): Promise<Response> {
	// Extract path and merge init options
	let path: string;
	let mergedInit: RequestInit = init || {};

	if (typeof input === "string") {
		path = input;
	} else if (input instanceof URL) {
		path = input.pathname + input.search;
	} else if (input instanceof Request) {
		// Extract path from Request URL
		const url = new URL(input.url);
		path = url.pathname + url.search;
		// Merge Request properties with init
		const requestHeaders = new Headers(input.headers);
		const initHeaders = new Headers(init?.headers || {});

		// Merge headers - init headers override request headers
		const mergedHeaders = new Headers(requestHeaders);
		for (const [key, value] of initHeaders) {
			mergedHeaders.set(key, value);
		}

		mergedInit = {
			method: input.method,
			body: input.body,
			mode: input.mode,
			credentials: input.credentials,
			redirect: input.redirect,
			referrer: input.referrer,
			referrerPolicy: input.referrerPolicy,
			integrity: input.integrity,
			keepalive: input.keepalive,
			signal: input.signal,
			...mergedInit, // init overrides Request properties
			headers: mergedHeaders, // headers must be set after spread to ensure proper merge
		};
		// Add duplex if body is present
		if (mergedInit.body) {
			(mergedInit as any).duplex = "half";
		}
	} else {
		throw new TypeError("Invalid input type for fetch");
	}

	// Use the driver's raw HTTP method - just pass the sub-path
	return await driver.rawHttpRequest(
		undefined,
		actorQuery,
		encodingKind,
		params,
		path,
		mergedInit,
		undefined,
	);
}

/**
 * Shared implementation for raw WebSocket connections
 */
export async function rawWebSocket(
	driver: ClientDriver,
	actorQuery: ActorQuery,
	encodingKind: Encoding,
	params: unknown,
	path?: string,
	protocols?: string | string[],
): Promise<any> {
	// Use the driver's raw WebSocket method
	return await driver.rawWebSocket(
		undefined,
		actorQuery,
		encodingKind,
		params,
		path || "",
		protocols,
		undefined,
	);
}
