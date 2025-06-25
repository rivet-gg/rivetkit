import type { ResponseError } from "@/actor/protocol/http/error";
import { assertUnreachable } from "@/common/utils";
import type { Encoding } from "@/mod";
import { httpUserAgent } from "@/utils";
import * as cbor from "cbor-x";
import { ActorError, HttpRequestError } from "./errors";
import { logger } from "./log";

export type WebSocketMessage = string | Blob | ArrayBuffer | Uint8Array;

export function messageLength(message: WebSocketMessage): number {
	if (message instanceof Blob) {
		return message.size;
	}
	if (message instanceof ArrayBuffer) {
		return message.byteLength;
	}
	if (message instanceof Uint8Array) {
		return message.byteLength;
	}
	if (typeof message === "string") {
		return message.length;
	}
	assertUnreachable(message);
}

export interface HttpRequestOpts<Body> {
	method: string;
	url: string;
	headers: Record<string, string>;
	body?: Body;
	encoding: Encoding;
	skipParseResponse?: boolean;
	signal?: AbortSignal;
	customFetch?: (req: Request) => Promise<Response>;
}

export async function sendHttpRequest<
	RequestBody = unknown,
	ResponseBody = unknown,
>(opts: HttpRequestOpts<RequestBody>): Promise<ResponseBody> {
	logger().debug("sending http request", {
		url: opts.url,
		encoding: opts.encoding,
	});

	// Serialize body
	let contentType: string | undefined = undefined;
	let bodyData: string | Buffer | undefined = undefined;
	if (opts.method === "POST" || opts.method === "PUT") {
		if (opts.encoding === "json") {
			contentType = "application/json";
			bodyData = JSON.stringify(opts.body);
		} else if (opts.encoding === "cbor") {
			contentType = "application/octet-stream";
			bodyData = cbor.encode(opts.body);
		} else {
			assertUnreachable(opts.encoding);
		}
	}

	// Send request
	let response: Response;
	try {
		// Make the HTTP request
		response = await (opts.customFetch ?? fetch)(
			new Request(opts.url, {
				method: opts.method,
				headers: {
					...opts.headers,
					...(contentType
						? {
								"Content-Type": contentType,
							}
						: {}),
					"User-Agent": httpUserAgent(),
				},
				body: bodyData,
				signal: opts.signal,
			}),
		);
	} catch (error) {
		throw new HttpRequestError(`Request failed: ${error}`, {
			cause: error,
		});
	}

	// Parse response error
	if (!response.ok) {
		// Attempt to parse structured data
		const bufferResponse = await response.arrayBuffer();
		let responseData: ResponseError;
		try {
			if (opts.encoding === "json") {
				const textResponse = new TextDecoder().decode(bufferResponse);
				responseData = JSON.parse(textResponse);
			} else if (opts.encoding === "cbor") {
				const uint8Array = new Uint8Array(bufferResponse);
				responseData = cbor.decode(uint8Array);
			} else {
				assertUnreachable(opts.encoding);
			}
		} catch (error) {
			//logger().warn("failed to cleanly parse error, this is likely because a non-structured response is being served", {
			//	error: stringifyError(error),
			//});

			// Error is not structured
			const textResponse = new TextDecoder("utf-8", { fatal: false }).decode(
				bufferResponse,
			);
			throw new HttpRequestError(
				`${response.statusText} (${response.status}):\n${textResponse}`,
			);
		}

		// Throw structured error
		throw new ActorError(responseData.c, responseData.m, responseData.md);
	}

	// Some requests don't need the success response to be parsed, so this can speed things up
	if (opts.skipParseResponse) {
		return undefined as ResponseBody;
	}

	// Parse the response based on encoding
	let responseBody: ResponseBody;
	try {
		if (opts.encoding === "json") {
			responseBody = (await response.json()) as ResponseBody;
		} else if (opts.encoding === "cbor") {
			const buffer = await response.arrayBuffer();
			const uint8Array = new Uint8Array(buffer);
			responseBody = cbor.decode(uint8Array);
		} else {
			assertUnreachable(opts.encoding);
		}
	} catch (error) {
		throw new HttpRequestError(`Failed to parse response: ${error}`, {
			cause: error,
		});
	}

	return responseBody;
}

export function serializeWithEncoding(
	encoding: Encoding,
	value: unknown,
): WebSocketMessage {
	if (encoding === "json") {
		return JSON.stringify(value);
	} else if (encoding === "cbor") {
		return cbor.encode(value);
	} else {
		assertUnreachable(encoding);
	}
}
