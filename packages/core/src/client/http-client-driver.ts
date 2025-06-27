import type { ActionRequest } from "@/actor/protocol/http/action";
import type * as protoHttpResolve from "@/actor/protocol/http/resolve";
import type { ActionResponse } from "@/actor/protocol/message/to-client";
import type * as wsToServer from "@/actor/protocol/message/to-server";
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
import { importWebSocket } from "@/common/websocket";
import type { ActorQuery } from "@/manager/protocol/query";
import { assertUnreachable, httpUserAgent } from "@/utils";
import type { EventSource } from "eventsource";
import type { Context as HonoContext } from "hono";
import type { WebSocket } from "ws";
import type { ClientDriver } from "./client";
import * as errors from "./errors";
import { logger } from "./log";
import { sendHttpRequest, serializeWithEncoding } from "./utils";

/**
 * Client driver that communicates with the manager via HTTP.
 */
export function createHttpClientDriver(managerEndpoint: string): ClientDriver {
	// Lazily import the dynamic imports so we don't have to turn `createClient` in to an aysnc fn
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

			const responseData = await sendHttpRequest<ActionRequest, ActionResponse>(
				{
					url: `${managerEndpoint}/registry/actors/actions/${encodeURIComponent(name)}`,
					method: "POST",
					headers: {
						[HEADER_ENCODING]: encoding,
						[HEADER_ACTOR_QUERY]: JSON.stringify(actorQuery),
						...(params !== undefined
							? { [HEADER_CONN_PARAMS]: JSON.stringify(params) }
							: {}),
					},
					body: { a: args } satisfies ActionRequest,
					encoding: encoding,
					signal: opts?.signal,
				},
			);

			return responseData.o as Response;
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
					Record<never, never>,
					protoHttpResolve.ResolveResponse
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
					body: {},
					encoding: encodingKind,
				});

				logger().debug("resolved actor ID", { actorId: result.i });
				return result.i;
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

			// HACK: See packages/platforms/cloudflare-workers/src/websocket.ts
			protocol.push("rivetkit");

			logger().debug("connecting to websocket", { url });
			const ws = new WebSocket(url, protocol);
			if (encodingKind === "cbor") {
				ws.binaryType = "arraybuffer";
			} else if (encodingKind === "json") {
				// HACK: Bun bug prevents changing binary type, so we ignore the error https://github.com/oven-sh/bun/issues/17005
				try {
					ws.binaryType = "blob" as any;
				} catch (error) {}
			} else {
				assertUnreachable(encodingKind);
			}

			// Node & web WebSocket types not compatible
			return ws as any;
		},

		connectSse: async (
			_c: HonoContext | undefined,
			actorQuery: ActorQuery,
			encodingKind: Encoding,
			params: unknown,
		): Promise<EventSource> => {
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

			return eventSource;
		},

		sendHttpMessage: async (
			_c: HonoContext | undefined,
			actorId: string,
			encoding: Encoding,
			connectionId: string,
			connectionToken: string,
			message: wsToServer.ToServer,
		): Promise<Response> => {
			// TODO: Implement ordered messages, this is not guaranteed order. Needs to use an index in order to ensure we can pipeline requests efficiently.
			// TODO: Validate that we're using HTTP/3 whenever possible for pipelining requests
			const messageSerialized = serializeWithEncoding(encoding, message);
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
			return res;
		},
	};

	return driver;
}
