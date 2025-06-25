import type * as wsToServer from "@/actor/protocol/message/to-server";
import type { Encoding } from "@/actor/protocol/serde";
import { assertUnreachable } from "@/actor/utils";
import type { ClientDriver } from "@/client/client";
import { ActorError as ClientActorError } from "@/client/errors";
import type { Transport } from "@/client/mod";
import { importWebSocket } from "@/common/websocket";
import type { ActorQuery } from "@/manager/protocol/query";
import type {
	TestInlineDriverCallRequest,
	TestInlineDriverCallResponse,
} from "@/manager/router";
import * as cbor from "cbor-x";
import type { EventSource } from "eventsource";
import type { Context as HonoContext } from "hono";
import type { WebSocket } from "ws";
import { logger } from "./log";

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
			actorQuery: ActorQuery,
			encoding: Encoding,
			params: unknown,
			name: string,
			args: Args,
		): Promise<Response> => {
			return makeInlineRequest<Response>(
				endpoint,
				encoding,
				transport,
				"action",
				[undefined, actorQuery, encoding, params, name, args],
			);
		},

		resolveActorId: async (
			c: HonoContext | undefined,
			actorQuery: ActorQuery,
			encodingKind: Encoding,
			params: unknown,
		): Promise<string> => {
			return makeInlineRequest<string>(
				endpoint,
				encodingKind,
				transport,
				"resolveActorId",
				[undefined, actorQuery, encodingKind, params],
			);
		},

		connectWebSocket: async (
			c: HonoContext | undefined,
			actorQuery: ActorQuery,
			encodingKind: Encoding,
			params: unknown,
		): Promise<WebSocket> => {
			const WebSocket = await importWebSocket();

			logger().info("creating websocket connection via test inline driver", {
				actorQuery,
				encodingKind,
			});

			// Create WebSocket connection to the test endpoint
			const wsUrl = new URL(
				`${endpoint}/.test/inline-driver/connect-websocket`,
			);
			wsUrl.searchParams.set("actorQuery", JSON.stringify(actorQuery));
			if (params !== undefined)
				wsUrl.searchParams.set("params", JSON.stringify(params));
			wsUrl.searchParams.set("encodingKind", encodingKind);

			// Convert http/https to ws/wss
			const wsProtocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
			const finalWsUrl = `${wsProtocol}//${wsUrl.host}${wsUrl.pathname}${wsUrl.search}`;

			logger().debug("connecting to websocket", { url: finalWsUrl });

			// Create and return the WebSocket
			// Node & browser WebSocket types are incompatible
			return new WebSocket(finalWsUrl, [
				// HACK: See packages/platforms/cloudflare-workers/src/websocket.ts
				"rivetkit",
			]) as any;
		},

		connectSse: async (
			c: HonoContext | undefined,
			actorQuery: ActorQuery,
			encodingKind: Encoding,
			params: unknown,
		): Promise<EventSource> => {
			logger().info("creating sse connection via test inline driver", {
				actorQuery,
				encodingKind,
				params,
			});

			// Dynamically import EventSource if needed
			const EventSourceImport = await import("eventsource");
			// Handle both ES modules (default) and CommonJS export patterns
			const EventSourceConstructor =
				(EventSourceImport as any).default || EventSourceImport;

			// Encode parameters for the URL
			const actorQueryParam = encodeURIComponent(JSON.stringify(actorQuery));
			const encodingParam = encodeURIComponent(encodingKind);
			const paramsParam = params
				? encodeURIComponent(JSON.stringify(params))
				: null;

			// Create SSE connection URL
			const sseUrl = new URL(`${endpoint}/.test/inline-driver/connect-sse`);
			sseUrl.searchParams.set("actorQueryRaw", actorQueryParam);
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
			actorId: string,
			encoding: Encoding,
			connectionId: string,
			connectionToken: string,
			message: wsToServer.ToServer,
		): Promise<Response> => {
			logger().info("sending http message via test inline driver", {
				actorId,
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
						actorId,
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
		throw new ClientActorError(
			callResponse.err.code,
			callResponse.err.message,
			callResponse.err.metadata,
		);
	} else {
		assertUnreachable(callResponse);
	}
}
