import type { Context as HonoContext } from "hono";
import invariant from "invariant";
import onChange from "on-change";
import type { WebSocket } from "ws";
import * as errors from "@/actor/errors";
import type {
	ActionRequest,
	ActionResponse,
} from "@/actor/protocol/http/action";
import type * as wsToServer from "@/actor/protocol/message/to-server";
import type { Encoding } from "@/actor/protocol/serde";
import {
	HEADER_CONN_ID,
	HEADER_CONN_PARAMS,
	HEADER_CONN_TOKEN,
	HEADER_ENCODING,
	HEADER_EXPOSE_INTERNAL_ERROR,
} from "@/actor/router-endpoints";
import { assertUnreachable } from "@/actor/utils";
import type { ClientDriver } from "@/client/client";
import { ActorError as ClientActorError } from "@/client/errors";
import { sendHttpRequest } from "@/client/utils";
import { importEventSource } from "@/common/eventsource";
import type { UniversalEventSource } from "@/common/eventsource-interface";
import { deconstructError } from "@/common/utils";
import type { ManagerDriver } from "@/manager/driver";
import type { ActorQuery } from "@/manager/protocol/query";
import type { RunConfig } from "@/mod";
import { httpUserAgent } from "@/utils";
import { logger } from "./log";

/**
 * Client driver that calls the manager driver inline.
 *
 * This is only applicable to standalone & coordinated topologies.
 *
 * This driver can access private resources.
 *
 * This driver serves a double purpose as:
 * - Providing the client for the internal requests
 * - Provide the driver for the manager HTTP router (see manager/router.ts)
 */
export function createInlineClientDriver(
	managerDriver: ManagerDriver,
): ClientDriver {
	const driver: ClientDriver = {
		action: async <Args extends Array<unknown> = unknown[], Response = unknown>(
			c: HonoContext | undefined,
			actorQuery: ActorQuery,
			encoding: Encoding,
			params: unknown,
			actionName: string,
			args: Args,
			opts: { signal?: AbortSignal },
		): Promise<Response> => {
			try {
				// Get the actor ID
				const { actorId } = await queryActor(c, actorQuery, managerDriver);
				logger().debug("found actor for action", { actorId });
				invariant(actorId, "Missing actor ID");

				// Invoke the action
				logger().debug("handling action", { actionName, encoding });
				const responseData = await sendHttpRequest<
					ActionRequest,
					ActionResponse
				>({
					url: `http://actor/action/${encodeURIComponent(actionName)}`,
					method: "POST",
					headers: {
						[HEADER_ENCODING]: encoding,
						...(params !== undefined
							? { [HEADER_CONN_PARAMS]: JSON.stringify(params) }
							: {}),
						[HEADER_EXPOSE_INTERNAL_ERROR]: "true",
					},
					body: { a: args } satisfies ActionRequest,
					encoding: encoding,
					customFetch: managerDriver.sendRequest.bind(managerDriver, actorId),
					signal: opts?.signal,
				});

				return responseData.o as Response;
			} catch (err) {
				// Standardize to ClientActorError instead of the native backend error
				const { code, message, metadata } = deconstructError(
					err,
					logger(),
					{},
					true,
				);
				const x = new ClientActorError(code, message, metadata);
				throw new ClientActorError(code, message, metadata);
			}
		},

		resolveActorId: async (
			c: HonoContext | undefined,
			actorQuery: ActorQuery,
			_encodingKind: Encoding,
		): Promise<string> => {
			// Get the actor ID
			const { actorId } = await queryActor(c, actorQuery, managerDriver);
			logger().debug("resolved actor", { actorId });
			invariant(actorId, "missing actor ID");

			return actorId;
		},

		connectWebSocket: async (
			c: HonoContext | undefined,
			actorQuery: ActorQuery,
			encodingKind: Encoding,
			params?: unknown,
		): Promise<WebSocket> => {
			// Get the actor ID
			const { actorId } = await queryActor(c, actorQuery, managerDriver);
			logger().debug("found actor for action", { actorId });
			invariant(actorId, "Missing actor ID");

			// Invoke the action
			logger().debug("opening websocket", { actorId, encoding: encodingKind });

			// Open WebSocket
			const ws = await managerDriver.openWebSocket(
				"/connect/websocket",
				actorId,
				encodingKind,
				params,
			);

			// Node & browser WebSocket types are incompatible
			return ws as any;
		},

		connectSse: async (
			c: HonoContext | undefined,
			actorQuery: ActorQuery,
			encodingKind: Encoding,
			params: unknown,
		): Promise<UniversalEventSource> => {
			// Get the actor ID
			const { actorId } = await queryActor(c, actorQuery, managerDriver);
			logger().debug("found actor for sse connection", { actorId });
			invariant(actorId, "Missing actor ID");

			logger().debug("opening sse connection", {
				actorId,
				encoding: encodingKind,
			});

			const EventSourceClass = await importEventSource();

			const eventSource = new EventSourceClass("http://actor/connect/sse", {
				fetch: (input, init) => {
					return fetch(input, {
						...init,
						headers: {
							...init?.headers,
							"User-Agent": httpUserAgent(),
							[HEADER_ENCODING]: encodingKind,
							...(params !== undefined
								? { [HEADER_CONN_PARAMS]: JSON.stringify(params) }
								: {}),
							[HEADER_EXPOSE_INTERNAL_ERROR]: "true",
						},
					});
				},
			}) as UniversalEventSource;

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
			logger().debug("sending http message", { actorId, connectionId });

			// Send an HTTP request to the connections endpoint
			return sendHttpRequest({
				url: "http://actor/connections/message",
				method: "POST",
				headers: {
					[HEADER_ENCODING]: encoding,
					[HEADER_CONN_ID]: connectionId,
					[HEADER_CONN_TOKEN]: connectionToken,
					[HEADER_EXPOSE_INTERNAL_ERROR]: "true",
				},
				body: message,
				encoding,
				skipParseResponse: true,
				customFetch: managerDriver.sendRequest.bind(managerDriver, actorId),
			});
		},

		rawHttpRequest: async (
			c: HonoContext | undefined,
			actorQuery: ActorQuery,
			encoding: Encoding,
			params: unknown,
			path: string,
			init: RequestInit,
		): Promise<Response> => {
			try {
				// Get the actor ID
				const { actorId } = await queryActor(c, actorQuery, managerDriver);
				logger().debug("found actor for raw http", { actorId });
				invariant(actorId, "Missing actor ID");

				// Build the URL with normalized path
				const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
				const url = new URL(`http://actor/raw/http/${normalizedPath}`);

				// Forward the request to the actor
				const proxyRequest = new Request(url, init);

				// Forward conn params if provided
				if (params) {
					proxyRequest.headers.set(HEADER_CONN_PARAMS, JSON.stringify(params));
				}

				return await managerDriver.sendRequest(actorId, proxyRequest);
			} catch (err) {
				// Standardize to ClientActorError instead of the native backend error
				const { code, message, metadata } = deconstructError(
					err,
					logger(),
					{},
					true,
				);
				throw new ClientActorError(code, message, metadata);
			}
		},

		rawWebSocket: async (
			c: HonoContext | undefined,
			actorQuery: ActorQuery,
			encoding: Encoding,
			params: unknown,
			path: string,
			protocols: string | string[] | undefined,
		): Promise<WebSocket> => {
			// Get the actor ID
			const { actorId } = await queryActor(c, actorQuery, managerDriver);
			logger().debug("found actor for action", { actorId });
			invariant(actorId, "Missing actor ID");

			// Normalize path to match raw HTTP behavior
			const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
			logger().debug("opening websocket", {
				actorId,
				encoding,
				path: normalizedPath,
			});

			// Open WebSocket
			const ws = await managerDriver.openWebSocket(
				`/raw/websocket/${normalizedPath}`,
				actorId,
				encoding,
				params,
			);

			// Node & browser WebSocket types are incompatible
			return ws as any;
		},
	};

	return driver;
}

/**
 * Query the manager driver to get or create a actor based on the provided query
 */
export async function queryActor(
	c: HonoContext | undefined,
	query: ActorQuery,
	driver: ManagerDriver,
): Promise<{ actorId: string }> {
	logger().debug("querying actor", { query });
	let actorOutput: { actorId: string };
	if ("getForId" in query) {
		const output = await driver.getForId({
			c,
			actorId: query.getForId.actorId,
		});
		if (!output) throw new errors.ActorNotFound(query.getForId.actorId);
		actorOutput = output;
	} else if ("getForKey" in query) {
		const existingActor = await driver.getWithKey({
			c,
			name: query.getForKey.name,
			key: query.getForKey.key,
		});
		if (!existingActor) {
			throw new errors.ActorNotFound(
				`${query.getForKey.name}:${JSON.stringify(query.getForKey.key)}`,
			);
		}
		actorOutput = existingActor;
	} else if ("getOrCreateForKey" in query) {
		const getOrCreateOutput = await driver.getOrCreateWithKey({
			c,
			name: query.getOrCreateForKey.name,
			key: query.getOrCreateForKey.key,
			input: query.getOrCreateForKey.input,
			region: query.getOrCreateForKey.region,
		});
		actorOutput = {
			actorId: getOrCreateOutput.actorId,
		};
	} else if ("create" in query) {
		const createOutput = await driver.createActor({
			c,
			name: query.create.name,
			key: query.create.key,
			input: query.create.input,
			region: query.create.region,
		});
		actorOutput = {
			actorId: createOutput.actorId,
		};
	} else {
		throw new errors.InvalidRequest("Invalid query format");
	}

	logger().debug("actor query result", {
		actorId: actorOutput.actorId,
	});
	return { actorId: actorOutput.actorId };
}

/**
 * Removes the on-change library's proxy recursively from a value so we can clone it with `structuredClone`.
 */
function unproxyRecursive<T>(objProxied: T): T {
	const obj = onChange.target<any>(objProxied);

	// Short circuit if this object was proxied
	//
	// If the reference is different, then this value was proxied and no
	// nested values are proxied
	if (obj !== objProxied) return obj;

	// Handle null/undefined
	if (!obj || typeof obj !== "object") {
		return obj;
	}

	// Handle arrays
	if (Array.isArray(obj)) {
		return obj.map((x) => unproxyRecursive<any>(x)) as T;
	}

	// Handle objects
	const result: any = {};
	for (const key in obj) {
		result[key] = unproxyRecursive<any>(obj[key]);
	}

	return result;
}
