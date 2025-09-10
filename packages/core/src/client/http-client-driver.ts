import * as cbor from "cbor-x";
import type { Context as HonoContext } from "hono";
import type { WebSocket } from "ws";
import type { Encoding } from "@/actor/protocol/serde";
import {
	HEADER_ACTOR_ID,
	HEADER_ACTOR_QUERY,
	HEADER_CONN_ID,
	HEADER_CONN_PARAMS,
	HEADER_CONN_TOKEN,
	HEADER_ENCODING,
} from "@/actor/router-endpoints";
import { importEventSource } from "@/common/eventsource";
import type { UniversalEventSource } from "@/common/eventsource-interface";
import { importWebSocket } from "@/common/websocket";
import type { ActorQuery } from "@/manager/protocol/query";
import type * as protocol from "@/schemas/client-protocol/mod";
import {
	HTTP_ACTION_REQUEST_VERSIONED,
	HTTP_ACTION_RESPONSE_VERSIONED,
	HTTP_RESOLVE_REQUEST_VERSIONED,
	HTTP_RESOLVE_RESPONSE_VERSIONED,
	TO_SERVER_VERSIONED,
} from "@/schemas/client-protocol/versioned";
import { serializeWithEncoding, wsBinaryTypeForEncoding } from "@/serde";
import { assertUnreachable, bufferToArrayBuffer, httpUserAgent } from "@/utils";
import type { ClientDriver } from "./client";
import * as errors from "./errors";
import { logger } from "./log";
import { sendHttpRequest } from "./utils";

/**
 * Client driver that communicates with the manager via HTTP.
 */
export function createHttpClientDriver(managerEndpoint: string): ClientDriver {
	// Lazily import the dynamic imports so we don't have to turn `createClient` in to an async fn
	const dynamicImports = (async () => {
		// Import dynamic dependencies
		const [WebSocket, EventSource] = await Promise.all([
			importWebSocket(),
			importEventSource(),
		]);
		return {
			WebSocket,
			EventSource,
		};
	})();

	const driver: ClientDriver = {
		action: async <Args extends Array<unknown> = unknown[], Response = unknown>(
			_c: HonoContext | undefined,
			actorQuery: ActorQuery,
			encoding: Encoding,
			params: unknown,
			name: string,
			args: Args,
			opts: { signal?: AbortSignal } | undefined,
		): Promise<Response> => {
			logger().debug("actor handle action", {
				name,
				args,
				query: actorQuery,
			});

			const responseData = await sendHttpRequest<
				protocol.HttpActionRequest,
				protocol.HttpActionResponse
			>({
				url: `${managerEndpoint}/registry/actors/actions/${encodeURIComponent(name)}`,
				method: "POST",
				headers: {
					[HEADER_ENCODING]: encoding,
					[HEADER_ACTOR_QUERY]: JSON.stringify(actorQuery),
					...(params !== undefined
						? { [HEADER_CONN_PARAMS]: JSON.stringify(params) }
						: {}),
				},
				body: {
					args: bufferToArrayBuffer(cbor.encode(args)),
				} satisfies protocol.HttpActionRequest,
				encoding: encoding,
				signal: opts?.signal,
				requestVersionedDataHandler: HTTP_ACTION_REQUEST_VERSIONED,
				responseVersionedDataHandler: HTTP_ACTION_RESPONSE_VERSIONED,
			});

			return cbor.decode(new Uint8Array(responseData.output));
		},

		resolveActorId: async (
			_c: HonoContext | undefined,
			actorQuery: ActorQuery,
			encodingKind: Encoding,
			params: unknown,
		): Promise<string> => {
			logger().debug("resolving actor ID", { query: actorQuery });

			try {
				const result = await sendHttpRequest<
					null,
					protocol.HttpResolveResponse
				>({
					url: `${managerEndpoint}/registry/actors/resolve`,
					method: "POST",
					headers: {
						[HEADER_ENCODING]: encodingKind,
						[HEADER_ACTOR_QUERY]: JSON.stringify(actorQuery),
						...(params !== undefined
							? { [HEADER_CONN_PARAMS]: JSON.stringify(params) }
							: {}),
					},
					body: null,
					encoding: encodingKind,
					requestVersionedDataHandler: HTTP_RESOLVE_REQUEST_VERSIONED,
					responseVersionedDataHandler: HTTP_RESOLVE_RESPONSE_VERSIONED,
				});

				logger().debug("resolved actor ID", { actorId: result.actorId });
				return result.actorId;
			} catch (error) {
				logger().error("failed to resolve actor ID", { error });
				if (error instanceof errors.ActorError) {
					throw error;
				} else {
					throw new errors.InternalError(
						`Failed to resolve actor ID: ${String(error)}`,
					);
				}
			}
		},

		connectWebSocket: async (
			_c: HonoContext | undefined,
			actorQuery: ActorQuery,
			encodingKind: Encoding,
			params: unknown,
		): Promise<WebSocket> => {
			const { WebSocket } = await dynamicImports;

			const endpoint = managerEndpoint
				.replace(/^http:/, "ws:")
				.replace(/^https:/, "wss:");
			const url = `${endpoint}/registry/actors/connect/websocket`;

			// Pass sensitive data via protocol
			const protocol = [
				`query.${encodeURIComponent(JSON.stringify(actorQuery))}`,
				`encoding.${encodingKind}`,
			];
			if (params)
				protocol.push(
					`conn_params.${encodeURIComponent(JSON.stringify(params))}`,
				);

			// HACK: See packages/drivers/cloudflare-workers/src/websocket.ts
			protocol.push("rivetkit");

			logger().debug("connecting to websocket", { url });
			const ws = new WebSocket(url, protocol);
			// HACK: Bun bug prevents changing binary type, so we ignore the error https://github.com/oven-sh/bun/issues/17005
			try {
				ws.binaryType = wsBinaryTypeForEncoding(encodingKind);
			} catch (error) {}

			// Node & web WebSocket types not compatible
			return ws as any;
		},

		connectSse: async (
			_c: HonoContext | undefined,
			actorQuery: ActorQuery,
			encodingKind: Encoding,
			params: unknown,
		): Promise<UniversalEventSource> => {
			const { EventSource } = await dynamicImports;

			const url = `${managerEndpoint}/registry/actors/connect/sse`;

			logger().debug("connecting to sse", { url });
			const eventSource = new EventSource(url, {
				fetch: (input, init) => {
					return fetch(input, {
						...init,
						headers: {
							...init?.headers,
							"User-Agent": httpUserAgent(),
							[HEADER_ENCODING]: encodingKind,
							[HEADER_ACTOR_QUERY]: JSON.stringify(actorQuery),
							...(params !== undefined
								? { [HEADER_CONN_PARAMS]: JSON.stringify(params) }
								: {}),
						},
						credentials: "include",
					});
				},
			});

			return eventSource as UniversalEventSource;
		},

		sendHttpMessage: async (
			_c: HonoContext | undefined,
			actorId: string,
			encoding: Encoding,
			connectionId: string,
			connectionToken: string,
			message: protocol.ToServer,
		): Promise<void> => {
			// TODO: Implement ordered messages, this is not guaranteed order. Needs to use an index in order to ensure we can pipeline requests efficiently.
			// TODO: Validate that we're using HTTP/3 whenever possible for pipelining requests
			const messageSerialized = serializeWithEncoding(
				encoding,
				message,
				TO_SERVER_VERSIONED,
			);
			const res = await fetch(`${managerEndpoint}/registry/actors/message`, {
				method: "POST",
				headers: {
					"User-Agent": httpUserAgent(),
					[HEADER_ENCODING]: encoding,
					[HEADER_ACTOR_ID]: actorId,
					[HEADER_CONN_ID]: connectionId,
					[HEADER_CONN_TOKEN]: connectionToken,
				},
				body: messageSerialized,
				credentials: "include",
			});
			if (!res.ok) {
				throw new errors.InternalError(
					`Publish message over HTTP error (${res.statusText}):\n${await res.text()}`,
				);
			}

			// Discard response
			await res.body?.cancel();
		},

		rawHttpRequest: async (
			_c: HonoContext | undefined,
			actorQuery: ActorQuery,
			encoding: Encoding,
			params: unknown,
			path: string,
			init: RequestInit,
		): Promise<Response> => {
			// Build the full URL
			// Remove leading slash from path to avoid double slashes
			const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
			const url = `${managerEndpoint}/registry/actors/raw/http/${normalizedPath}`;

			logger().debug("rewriting http url", {
				from: path,
				to: url,
			});

			// Merge headers properly
			const headers = new Headers(init.headers);
			headers.set("User-Agent", httpUserAgent());
			headers.set(HEADER_ACTOR_QUERY, JSON.stringify(actorQuery));
			headers.set(HEADER_ENCODING, encoding);
			if (params !== undefined) {
				headers.set(HEADER_CONN_PARAMS, JSON.stringify(params));
			}

			// Forward the request with query in headers
			return await fetch(url, {
				...init,
				headers,
			});
		},

		rawWebSocket: async (
			_c: HonoContext | undefined,
			actorQuery: ActorQuery,
			encoding: Encoding,
			params: unknown,
			path: string,
			protocols: string | string[] | undefined,
		): Promise<WebSocket> => {
			const { WebSocket } = await dynamicImports;

			// Build the WebSocket URL with normalized path
			const wsEndpoint = managerEndpoint
				.replace(/^http:/, "ws:")
				.replace(/^https:/, "wss:");
			// Normalize path to match raw HTTP behavior
			const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
			const url = `${wsEndpoint}/registry/actors/raw/websocket/${normalizedPath}`;

			logger().debug("rewriting websocket url", {
				from: path,
				to: url,
			});

			// Pass data via WebSocket protocol subprotocols
			const protocolList: string[] = [];
			protocolList.push(
				`query.${encodeURIComponent(JSON.stringify(actorQuery))}`,
			);
			protocolList.push(`encoding.${encoding}`);
			if (params) {
				protocolList.push(
					`conn_params.${encodeURIComponent(JSON.stringify(params))}`,
				);
			}

			// HACK: See packages/drivers/cloudflare-workers/src/websocket.ts
			protocolList.push("rivetkit");

			// Add user protocols
			if (protocols) {
				if (Array.isArray(protocols)) {
					protocolList.push(...protocols);
				} else {
					protocolList.push(protocols);
				}
			}

			// Create WebSocket connection
			logger().debug("opening raw websocket", { url });
			return new WebSocket(url, protocolList) as any;
		},
	};

	return driver;
}
