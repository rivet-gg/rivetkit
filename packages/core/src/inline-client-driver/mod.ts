import * as errors from "@/worker/errors";
import * as protoHttpAction from "@/worker/protocol/http/action";
import { logger } from "./log";
import type { EventSource } from "eventsource";
import type * as wsToServer from "@/worker/protocol/message/to-server";
import { type Encoding, serialize } from "@/worker/protocol/serde";
import {
	ConnectWebSocketOutput,
	HEADER_CONN_PARAMS,
	HEADER_ENCODING,
	HEADER_CONN_ID,
	HEADER_CONN_TOKEN,
	type ConnectionHandlers,
	HEADER_EXPOSE_INTERNAL_ERROR,
} from "@/worker/router-endpoints";
import type { SSEStreamingApi } from "hono/streaming";
import { HonoRequest, type Context as HonoContext, type Next } from "hono";
import invariant from "invariant";
import { ClientDriver } from "@/client/client";
import { ManagerDriver } from "@/manager/driver";
import { WorkerQuery } from "@/manager/protocol/query";
import { ConnRoutingHandler } from "@/worker/conn-routing-handler";
import { sendHttpRequest, serializeWithEncoding } from "@/client/utils";
import { ActionRequest, ActionResponse } from "@/worker/protocol/http/action";
import { assertUnreachable } from "@/worker/utils";
import { FakeWebSocket } from "./fake-websocket";
import { FakeEventSource } from "./fake-event-source";
import { importWebSocket } from "@/common/websocket";
import { importEventSource } from "@/common/eventsource";
import onChange from "on-change";
import { httpUserAgent } from "@/utils";
import { WorkerError as ClientWorkerError } from "@/client/errors";
import { deconstructError } from "@/common/utils";
import type { WebSocket } from "ws";

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
			workerQuery: WorkerQuery,
			encoding: Encoding,
			params: unknown,
			actionName: string,
			args: Args,
			opts: { signal?: AbortSignal },
		): Promise<Response> => {
			try {
				// Get the worker ID
				const { workerId } = await queryWorker(c, workerQuery, managerDriver);
				logger().debug("found worker for action", { workerId });
				invariant(workerId, "Missing worker ID");

				// Invoke the action
				logger().debug("handling action", { actionName, encoding });
				if ("inline" in routingHandler) {
					const { output } = await routingHandler.inline.handlers.onAction({
						req: c?.req,
						params,
						actionName,
						actionArgs: args,
						workerId,
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
						// HACK: If we return a value that references the worker state (i.e. an on-change value),
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
						url: `http://worker/action/${encodeURIComponent(actionName)}`,
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
							workerId,
						),
						signal: opts?.signal,
					});

					return responseData.o as Response;
				} else {
					assertUnreachable(routingHandler);
				}
			} catch (err) {
				// Standardize to ClientWorkerError instead of the native backend error
				const { code, message, metadata } = deconstructError(
					err,
					logger(),
					{},
					true,
				);
				const x = new ClientWorkerError(code, message, metadata);
				throw new ClientWorkerError(code, message, metadata);
			}
		},

		resolveWorkerId: async (
			c: HonoContext | undefined,
			workerQuery: WorkerQuery,
			_encodingKind: Encoding,
		): Promise<string> => {
			// Get the worker ID
			const { workerId } = await queryWorker(c, workerQuery, managerDriver);
			logger().debug("resolved worker", { workerId });
			invariant(workerId, "missing worker ID");

			return workerId;
		},

		connectWebSocket: async (
			c: HonoContext | undefined,
			workerQuery: WorkerQuery,
			encodingKind: Encoding,
			params?: unknown,
		): Promise<WebSocket> => {
			// Get the worker ID
			const { workerId } = await queryWorker(c, workerQuery, managerDriver);
			logger().debug("found worker for action", { workerId });
			invariant(workerId, "Missing worker ID");

			// Invoke the action
			logger().debug("opening websocket", { workerId, encoding: encodingKind });
			if ("inline" in routingHandler) {
				invariant(
					routingHandler.inline.handlers.onConnectWebSocket,
					"missing onConnectWebSocket handler",
				);

				logger().debug("calling onConnectWebSocket handler", {
					workerId,
					encoding: encodingKind,
				});

				// Create handler
				const output = await routingHandler.inline.handlers.onConnectWebSocket({
					req: c?.req,
					encoding: encodingKind,
					workerId,
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
					workerId,
					encodingKind,
					params,
				);

				return ws;
			} else {
				assertUnreachable(routingHandler);
			}
		},

		connectSse: async (
			c: HonoContext | undefined,
			workerQuery: WorkerQuery,
			encodingKind: Encoding,
			params: unknown,
		): Promise<EventSource> => {
			// Get the worker ID
			const { workerId } = await queryWorker(c, workerQuery, managerDriver);
			logger().debug("found worker for sse connection", { workerId });
			invariant(workerId, "Missing worker ID");

			logger().debug("opening sse connection", {
				workerId,
				encoding: encodingKind,
			});

			if ("inline" in routingHandler) {
				invariant(
					routingHandler.inline.handlers.onConnectSse,
					"missing onConnectSse handler",
				);

				logger().debug("calling onConnectSse handler", {
					workerId,
					encoding: encodingKind,
				});

				// Create handler
				const output = await routingHandler.inline.handlers.onConnectSse({
					req: c?.req,
					encoding: encodingKind,
					params,
					workerId,
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

				const eventSource = new EventSourceClass("http://worker/connect/sse", {
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
			workerId: string,
			encoding: Encoding,
			connectionId: string,
			connectionToken: string,
			message: wsToServer.ToServer,
		): Promise<Response> => {
			logger().debug("sending http message", { workerId, connectionId });

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
					workerId,
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
					url: "http://worker/connections/message",
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
						workerId,
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
 * Query the manager driver to get or create a worker based on the provided query
 */
export async function queryWorker(
	c: HonoContext | undefined,
	query: WorkerQuery,
	driver: ManagerDriver,
): Promise<{ workerId: string }> {
	logger().debug("querying worker", { query });
	let workerOutput: { workerId: string };
	if ("getForId" in query) {
		const output = await driver.getForId({
			c,
			workerId: query.getForId.workerId,
		});
		if (!output) throw new errors.WorkerNotFound(query.getForId.workerId);
		workerOutput = output;
	} else if ("getForKey" in query) {
		const existingWorker = await driver.getWithKey({
			c,
			name: query.getForKey.name,
			key: query.getForKey.key,
		});
		if (!existingWorker) {
			throw new errors.WorkerNotFound(
				`${query.getForKey.name}:${JSON.stringify(query.getForKey.key)}`,
			);
		}
		workerOutput = existingWorker;
	} else if ("getOrCreateForKey" in query) {
		const getOrCreateOutput = await driver.getOrCreateWithKey({
			c,
			name: query.getOrCreateForKey.name,
			key: query.getOrCreateForKey.key,
			input: query.getOrCreateForKey.input,
			region: query.getOrCreateForKey.region,
		});
		workerOutput = {
			workerId: getOrCreateOutput.workerId,
		};
	} else if ("create" in query) {
		const createOutput = await driver.createWorker({
			c,
			name: query.create.name,
			key: query.create.key,
			input: query.create.input,
			region: query.create.region,
		});
		workerOutput = {
			workerId: createOutput.workerId,
		};
	} else {
		throw new errors.InvalidRequest("Invalid query format");
	}

	logger().debug("worker query result", {
		workerId: workerOutput.workerId,
	});
	return { workerId: workerOutput.workerId };
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
