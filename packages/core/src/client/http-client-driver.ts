import * as cbor from "cbor-x";
import type { Encoding } from "@/worker/protocol/serde";
import type { WorkerQuery } from "@/manager/protocol/query";
import * as errors from "./errors";
import { logger } from "./log";
import type * as wsToServer from "@/worker/protocol/message/to-server";
import type * as protoHttpResolve from "@/worker/protocol/http/resolve";
import { assertUnreachable, httpUserAgent } from "@/utils";
import {
	HEADER_WORKER_ID,
	HEADER_WORKER_QUERY,
	HEADER_CONN_ID,
	HEADER_CONN_PARAMS,
	HEADER_CONN_TOKEN,
	HEADER_ENCODING,
} from "@/worker/router-endpoints";
import type { EventSource } from "eventsource";
import { importWebSocket } from "@/common/websocket";
import { importEventSource } from "@/common/eventsource";
import {
	sendHttpRequest,
	serializeWithEncoding,
	type WebSocketMessage,
} from "./utils";
import type { ActionRequest } from "@/worker/protocol/http/action";
import type { ActionResponse } from "@/worker/protocol/message/to-client";
import { ClientDriver } from "./client";
import { HonoRequest, Context as HonoContext } from "hono";
import type { WebSocket } from "ws";

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
			workerQuery: WorkerQuery,
			encoding: Encoding,
			params: unknown,
			name: string,
			args: Args,
			opts: { signal?: AbortSignal } | undefined,
		): Promise<Response> => {
			logger().debug("worker handle action", {
				name,
				args,
				query: workerQuery,
			});

			const responseData = await sendHttpRequest<ActionRequest, ActionResponse>(
				{
					url: `${managerEndpoint}/workers/actions/${encodeURIComponent(name)}`,
					method: "POST",
					headers: {
						[HEADER_ENCODING]: encoding,
						[HEADER_WORKER_QUERY]: JSON.stringify(workerQuery),
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

		resolveWorkerId: async (
			_c: HonoContext | undefined,
			workerQuery: WorkerQuery,
			encodingKind: Encoding,
			params: unknown,
		): Promise<string> => {
			logger().debug("resolving worker ID", { query: workerQuery });

			try {
				const result = await sendHttpRequest<
					Record<never, never>,
					protoHttpResolve.ResolveResponse
				>({
					url: `${managerEndpoint}/workers/resolve`,
					method: "POST",
					headers: {
						[HEADER_ENCODING]: encodingKind,
						[HEADER_WORKER_QUERY]: JSON.stringify(workerQuery),
						...(params !== undefined
							? { [HEADER_CONN_PARAMS]: JSON.stringify(params) }
							: {}),
					},
					body: {},
					encoding: encodingKind,
				});

				logger().debug("resolved worker ID", { workerId: result.i });
				return result.i;
			} catch (error) {
				logger().error("failed to resolve worker ID", { error });
				if (error instanceof errors.WorkerError) {
					throw error;
				} else {
					throw new errors.InternalError(
						`Failed to resolve worker ID: ${String(error)}`,
					);
				}
			}
		},

		connectWebSocket: async (
			_c: HonoContext | undefined,
			workerQuery: WorkerQuery,
			encodingKind: Encoding,
			params: unknown,
		): Promise<WebSocket> => {
			const { WebSocket } = await dynamicImports;

			const endpoint = managerEndpoint
				.replace(/^http:/, "ws:")
				.replace(/^https:/, "wss:");
			const url = `${endpoint}/workers/connect/websocket`;

			// Pass sensitive data via protocol
			const protocol = [
				`query.${encodeURIComponent(JSON.stringify(workerQuery))}`,
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
			workerQuery: WorkerQuery,
			encodingKind: Encoding,
			params: unknown,
		): Promise<EventSource> => {
			const { EventSource } = await dynamicImports;

			const url = `${managerEndpoint}/workers/connect/sse`;

			logger().debug("connecting to sse", { url });
			const eventSource = new EventSource(url, {
				fetch: (input, init) => {
					return fetch(input, {
						...init,
						headers: {
							...init?.headers,
							"User-Agent": httpUserAgent(),
							[HEADER_ENCODING]: encodingKind,
							[HEADER_WORKER_QUERY]: JSON.stringify(workerQuery),
							...(params !== undefined
								? { [HEADER_CONN_PARAMS]: JSON.stringify(params) }
								: {}),
						},
					});
				},
			});

			return eventSource;
		},

		sendHttpMessage: async (
			_c: HonoContext | undefined,
			workerId: string,
			encoding: Encoding,
			connectionId: string,
			connectionToken: string,
			message: wsToServer.ToServer,
		): Promise<Response> => {
			// TODO: Implement ordered messages, this is not guaranteed order. Needs to use an index in order to ensure we can pipeline requests efficiently.
			// TODO: Validate that we're using HTTP/3 whenever possible for pipelining requests
			const messageSerialized = serializeWithEncoding(encoding, message);
			const res = await fetch(`${managerEndpoint}/workers/message`, {
				method: "POST",
				headers: {
					"User-Agent": httpUserAgent(),
					[HEADER_ENCODING]: encoding,
					[HEADER_WORKER_ID]: workerId,
					[HEADER_CONN_ID]: connectionId,
					[HEADER_CONN_TOKEN]: connectionToken,
				},
				body: messageSerialized,
			});
			return res;
		},
	};

	return driver;
}
