import { ClientDriver } from "@/client/client";
import { type Encoding } from "@/worker/protocol/serde";
import type * as wsToServer from "@/worker/protocol/message/to-server";
import type { WorkerQuery } from "@/manager/protocol/query";
import { Context as HonoContext } from "hono";
import type { EventSource } from "eventsource";
import { Transport } from "@/client/mod";
import { logger } from "./log";
import {
	TestInlineDriverCallRequest,
	TestInlineDriverCallResponse,
} from "@/manager/router";
import { assertUnreachable } from "@/worker/utils";
import * as cbor from "cbor-x";
import { WorkerError as ClientWorkerError } from "@/client/errors";
import type { WebSocket } from "ws";
import { importWebSocket } from "@/common/websocket";

/**
 * Creates a client driver used for testing the inline client driver. This will send a request to the HTTP server which will then internally call the internal client and return the response.
 */
export function createTestInlineClientDriver(
	endpoint: string,
	transport: Transport,
): ClientDriver {
	return {
		action: async <Args extends Array<unknown> = unknown[], Response = unknown>(
			c: HonoContext | undefined,
			workerQuery: WorkerQuery,
			encoding: Encoding,
			params: unknown,
			name: string,
			args: Args
		): Promise<Response> => {
			return makeInlineRequest<Response>(
				endpoint,
				encoding,
				transport,
				"action",
				[undefined, workerQuery, encoding, params, name, args],
			);
		},

		resolveWorkerId: async (
			c: HonoContext | undefined,
			workerQuery: WorkerQuery,
			encodingKind: Encoding,
			params: unknown,
		): Promise<string> => {
			return makeInlineRequest<string>(
				endpoint,
				encodingKind,
				transport,
				"resolveWorkerId",
				[undefined, workerQuery, encodingKind, params],
			);
		},

		connectWebSocket: async (
			c: HonoContext | undefined,
			workerQuery: WorkerQuery,
			encodingKind: Encoding,
			params: unknown,
		): Promise<WebSocket> => {
			const WebSocket = await importWebSocket();

			logger().info("creating websocket connection via test inline driver", {
				workerQuery,
				encodingKind,
			});

			// Create WebSocket connection to the test endpoint
			const wsUrl = new URL(
				`${endpoint}/.test/inline-driver/connect-websocket`,
			);
			wsUrl.searchParams.set("workerQuery", JSON.stringify(workerQuery));
			if (params !== undefined)
				wsUrl.searchParams.set("params", JSON.stringify(params));
			wsUrl.searchParams.set("encodingKind", encodingKind);

			// Convert http/https to ws/wss
			const wsProtocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
			const finalWsUrl = `${wsProtocol}//${wsUrl.host}${wsUrl.pathname}${wsUrl.search}`;

			logger().debug("connecting to websocket", { url: finalWsUrl });

			// Create and return the WebSocket
			return new WebSocket(finalWsUrl, [
				// HACK: See packages/platforms/cloudflare-workers/src/websocket.ts
				"rivetkit",
			]);
		},

		connectSse: async (
			c: HonoContext | undefined,
			workerQuery: WorkerQuery,
			encodingKind: Encoding,
			params: unknown,
		): Promise<EventSource> => {
			logger().info("creating sse connection via test inline driver", {
				workerQuery,
				encodingKind,
				params,
			});

			// Dynamically import EventSource if needed
			const EventSourceImport = await import("eventsource");
			// Handle both ES modules (default) and CommonJS export patterns
			const EventSourceConstructor =
				(EventSourceImport as any).default || EventSourceImport;

			// Encode parameters for the URL
			const workerQueryParam = encodeURIComponent(JSON.stringify(workerQuery));
			const encodingParam = encodeURIComponent(encodingKind);
			const paramsParam = params
				? encodeURIComponent(JSON.stringify(params))
				: null;

			// Create SSE connection URL
			const sseUrl = new URL(`${endpoint}/.test/inline-driver/connect-sse`);
			sseUrl.searchParams.set("workerQueryRaw", workerQueryParam);
			sseUrl.searchParams.set("encodingKind", encodingParam);
			if (paramsParam) {
				sseUrl.searchParams.set("params", paramsParam);
			}

			logger().debug("connecting to sse", { url: sseUrl.toString() });

			// Create and return the EventSource
			const eventSource = new EventSourceConstructor(sseUrl.toString());

			// Wait for the connection to be established before returning
			await new Promise<void>((resolve, reject) => {
				eventSource.onopen = () => {
					logger().debug("sse connection established");
					resolve();
				};

				eventSource.onerror = (event: Event) => {
					logger().error("sse connection failed", { event });
					reject(new Error("Failed to establish SSE connection"));
				};

				// Set a timeout in case the connection never establishes
				setTimeout(() => {
					if (eventSource.readyState !== EventSourceConstructor.OPEN) {
						reject(new Error("SSE connection timed out"));
					}
				}, 10000); // 10 second timeout
			});

			return eventSource;
		},

		sendHttpMessage: async (
			c: HonoContext | undefined,
			workerId: string,
			encoding: Encoding,
			connectionId: string,
			connectionToken: string,
			message: wsToServer.ToServer,
		): Promise<Response> => {
			logger().info("sending http message via test inline driver", {
				workerId,
				encoding,
				connectionId,
				transport,
			});

			const result = await fetch(`${endpoint}/.test/inline-driver/call`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					encoding,
					transport,
					method: "sendHttpMessage",
					args: [
						undefined,
						workerId,
						encoding,
						connectionId,
						connectionToken,
						message,
					],
				} satisfies TestInlineDriverCallRequest),
			});

			if (!result.ok) {
				throw new Error(`Failed to send HTTP message: ${result.statusText}`);
			}

			// Need to create a Response object from the proxy response
			return new Response(await result.text(), {
				status: result.status,
				statusText: result.statusText,
				headers: result.headers,
			});
		},
	};
}

async function makeInlineRequest<T>(
	endpoint: string,
	encoding: Encoding,
	transport: Transport,
	method: string,
	args: unknown[],
): Promise<T> {
	logger().info("sending inline request", {
		encoding,
		transport,
		method,
		args,
	});

	// Call driver
	const response = await fetch(`${endpoint}/.test/inline-driver/call`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: cbor.encode({
			encoding,
			transport,
			method,
			args,
		} satisfies TestInlineDriverCallRequest),
	});

	if (!response.ok) {
		throw new Error(`Failed to call inline ${method}: ${response.statusText}`);
	}

	// Parse response
	const buffer = await response.arrayBuffer();
	const callResponse: TestInlineDriverCallResponse<T> = cbor.decode(
		new Uint8Array(buffer),
	);

	// Throw or OK
	if ("ok" in callResponse) {
		return callResponse.ok;
	} else if ("err" in callResponse) {
		throw new ClientWorkerError(
			callResponse.err.code,
			callResponse.err.message,
			callResponse.err.metadata,
		);
	} else {
		assertUnreachable(callResponse);
	}
}
