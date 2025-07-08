import type { EventSource } from "eventsource";
import type { Context as HonoContext } from "hono";
import invariant from "invariant";
import onChange from "on-change";
import type { WebSocket } from "ws";
import type { ConnRoutingHandler } from "@/actor/conn-routing-handler";
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
import { deconstructError } from "@/common/utils";
import type { ManagerDriver } from "@/manager/driver";
import type { ActorQuery } from "@/manager/protocol/query";
import { httpUserAgent } from "@/utils";
import { FakeEventSource } from "./fake-event-source";
import { FakeWebSocket } from "./fake-websocket";
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
	routingHandler: ConnRoutingHandler,
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
				if ("inline" in routingHandler) {
					const { output } = await routingHandler.inline.handlers.onAction({
						req: c?.req,
						params,
						actionName,
						actionArgs: args,
						actorId,
						// No auth data since this is from internal
						authData: undefined,
					});

					try {
						// Normally, the output is serialized over the network and is safe to mutate
						//
						// In this case, this value is referencing the same value in the original
						// state, so we have to clone it to ensure that it's safe to mutate
						// without mutating the main state
						return structuredClone(output) as Response;
					} catch (err) {
						// HACK: If we return a value that references the actor state (i.e. an on-change value),
						// this will throw an error. We fall back to `DataCloneError`.
						if (err instanceof DOMException && err.name === "DataCloneError") {
							logger().trace(
								"received DataCloneError which means that there was an on-change value, unproxying recursively",
							);
							return structuredClone(unproxyRecursive(output as Response));
						} else {
							throw err;
						}
					}
				} else if ("custom" in routingHandler) {
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
						customFetch: routingHandler.custom.sendRequest.bind(
							undefined,
							actorId,
						),
						signal: opts?.signal,
					});

					return responseData.o as Response;
				} else {
					assertUnreachable(routingHandler);
				}
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
			if ("inline" in routingHandler) {
				invariant(
					routingHandler.inline.handlers.onConnectWebSocket,
					"missing onConnectWebSocket handler",
				);

				logger().debug("calling onConnectWebSocket handler", {
					actorId,
					encoding: encodingKind,
				});

				// Create handler
				const output = await routingHandler.inline.handlers.onConnectWebSocket({
					req: c?.req,
					encoding: encodingKind,
					actorId,
					params,
					// No auth data since this is from internal
					authData: undefined,
				});

				logger().debug("got ConnectWebSocketOutput, creating FakeWebSocket");

				// TODO: There might be a bug where mutating data from the response of an action over a websocket will mutate the original data. See note about `structuredClone` in `action`
				// Create and initialize the FakeWebSocket, waiting for it to be ready
				const webSocket = new FakeWebSocket(output) as any as WebSocket;
				logger().debug("FakeWebSocket created and initialized");

				return webSocket;
			} else if ("custom" in routingHandler) {
				// Open WebSocket
				const ws = await routingHandler.custom.openWebSocket(
					actorId,
					encodingKind,
					params,
				);

				// Node & browser WebSocket types are incompatible
				return ws as any;
			} else {
				assertUnreachable(routingHandler);
			}
		},

		connectSse: async (
			c: HonoContext | undefined,
			actorQuery: ActorQuery,
			encodingKind: Encoding,
			params: unknown,
		): Promise<EventSource> => {
			// Get the actor ID
			const { actorId } = await queryActor(c, actorQuery, managerDriver);
			logger().debug("found actor for sse connection", { actorId });
			invariant(actorId, "Missing actor ID");

			logger().debug("opening sse connection", {
				actorId,
				encoding: encodingKind,
			});

			if ("inline" in routingHandler) {
				invariant(
					routingHandler.inline.handlers.onConnectSse,
					"missing onConnectSse handler",
				);

				logger().debug("calling onConnectSse handler", {
					actorId,
					encoding: encodingKind,
				});

				// Create handler
				const output = await routingHandler.inline.handlers.onConnectSse({
					req: c?.req,
					encoding: encodingKind,
					params,
					actorId,
					// No auth data since this is from internal
					authData: undefined,
				});

				logger().debug("got ConnectSseOutput, creating FakeEventSource");

				// Create a FakeEventSource that will connect to the output handler
				const eventSource = new FakeEventSource(async () => {
					try {
						await output.onClose();
					} catch (err) {
						logger().error("error closing sse connection", { error: err });
					}
				});

				// Initialize the connection
				await output.onOpen(eventSource.getStream());

				return eventSource as unknown as EventSource;
			} else if ("custom" in routingHandler) {
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
				}) as EventSource;

				return eventSource;
			} else {
				assertUnreachable(routingHandler);
			}
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

			if ("inline" in routingHandler) {
				invariant(
					routingHandler.inline.handlers.onConnMessage,
					"missing onConnMessage handler",
				);

				// Call the handler directly
				await routingHandler.inline.handlers.onConnMessage({
					req: c?.req,
					connId: connectionId,
					connToken: connectionToken,
					message,
					actorId,
				});

				// Return empty response
				return new Response(JSON.stringify({}), {
					headers: {
						"Content-Type": "application/json",
					},
				});
			} else if ("custom" in routingHandler) {
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
					customFetch: routingHandler.custom.sendRequest.bind(
						undefined,
						actorId,
					),
				});
			} else {
				assertUnreachable(routingHandler);
			}
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
