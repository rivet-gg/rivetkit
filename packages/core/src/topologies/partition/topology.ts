import { Hono, HonoRequest } from "hono";
import { createWorkerRouter } from "@/topologies/partition/worker-router";
import type { AnyWorkerInstance } from "@/worker/instance";
import * as errors from "@/worker/errors";
import {
	type AnyConn,
	generateConnId,
	generateConnToken,
} from "@/worker/connection";
import { logger } from "./log";
import { ActionContext } from "@/worker/action";
import {
	CONN_DRIVER_GENERIC_HTTP,
	CONN_DRIVER_GENERIC_SSE,
	CONN_DRIVER_GENERIC_WEBSOCKET,
	createGenericConnDrivers,
	GenericConnGlobalState,
	type GenericHttpDriverState,
	type GenericSseDriverState,
	type GenericWebSocketDriverState,
} from "../common/generic-conn-driver";
import type { ConnDriver } from "@/worker/driver";
import type { WorkerKey } from "@/common/utils";
import type { RegistryConfig } from "@/registry/config";
import { createManagerRouter } from "@/manager/router";
import type {
	ConnectWebSocketOpts,
	ConnectSseOpts,
	ActionOpts,
	ConnsMessageOpts,
	ConnectWebSocketOutput,
	ConnectSseOutput,
	ActionOutput,
} from "@/worker/router-endpoints";
import { ClientDriver } from "@/client/client";
import { ToServer } from "@/worker/protocol/message/to-server";
import { WorkerQuery } from "@/manager/protocol/query";
import { Encoding } from "@/mod";
import { EventSource } from "eventsource";
import { createInlineClientDriver } from "@/inline-client-driver/mod";
import {
	ConnRoutingHandler,
	ConnRoutingHandlerCustom,
} from "@/worker/conn-routing-handler";
import invariant from "invariant";
import type { WebSocket } from "ws";
import type { DriverConfig, RunConfig } from "@/registry/run-config";

export type SendRequestHandler = (
	workerRequest: Request,
	workerId: string,
) => Promise<Response>;

export type OpenWebSocketHandler = (
	path: string,
	workerId: string,
) => Promise<WebSocket>;

export class PartitionTopologyManager {
	clientDriver: ClientDriver;
	router: Hono;

	constructor(
		registryConfig: RegistryConfig,
		runConfig: RunConfig,
		customRoutingHandlers: ConnRoutingHandlerCustom,
	) {
		const routingHandler: ConnRoutingHandler = {
			custom: customRoutingHandlers,
		};

		const managerDriver = runConfig.driver.manager;
		invariant(managerDriver, "missing manager driver");
		this.clientDriver = createInlineClientDriver(managerDriver, routingHandler);

		this.router = createManagerRouter(
			registryConfig,
			runConfig,
			this.clientDriver,
			{
				routingHandler,
				// onConnectInspector: async () => {
				// 	const inspector = driverConfig.drivers?.manager?.inspector;
				// 	if (!inspector) throw new errors.Unsupported("inspector");
				//
				// 	let conn: ManagerInspectorConnection | undefined;
				// 	return {
				// 		onOpen: async (ws) => {
				// 			conn = inspector.createConnection(ws);
				// 		},
				// 		onMessage: async (message) => {
				// 			if (!conn) {
				// 				logger().warn("`conn` does not exist");
				// 				return;
				// 			}
				//
				// 			inspector.processMessage(conn, message);
				// 		},
				// 		onClose: async () => {
				// 			if (conn) {
				// 				inspector.removeConnection(conn);
				// 			}
				// 		},
				// 	};
				// },
			},
		);
	}
}

/** Manages the worker in the topology. */
export class PartitionTopologyWorker {
	router: Hono;

	#registryConfig: RegistryConfig;
	#runConfig: RunConfig;
	#connDrivers: Record<string, ConnDriver>;
	#worker?: AnyWorkerInstance;

	get worker(): AnyWorkerInstance {
		if (!this.#worker) throw new Error("Worker not loaded");
		return this.#worker;
	}

	/**
	 * Promise used to wait until the worker is started. All network requests wait on this promise in order to ensure they're not accessing the worker before initialize.
	 **/
	#workerStartedPromise?: PromiseWithResolvers<void> = Promise.withResolvers();

	constructor(registryConfig: RegistryConfig, runConfig: RunConfig) {
		this.#registryConfig = registryConfig;
		this.#runConfig = runConfig;

		const genericConnGlobalState = new GenericConnGlobalState();
		this.#connDrivers = createGenericConnDrivers(genericConnGlobalState);

		// TODO: Store this worker router globally so we're not re-initializing it for every DO
		this.router = createWorkerRouter(registryConfig, runConfig, {
			getWorkerId: async () => {
				if (this.#workerStartedPromise)
					await this.#workerStartedPromise.promise;
				return this.worker.id;
			},
			connectionHandlers: {
				onConnectWebSocket: async (
					opts: ConnectWebSocketOpts,
				): Promise<ConnectWebSocketOutput> => {
					if (this.#workerStartedPromise)
						await this.#workerStartedPromise.promise;

					const worker = this.#worker;
					if (!worker) throw new Error("Worker should be defined");

					const connId = generateConnId();
					const connToken = generateConnToken();
					const connState = await worker.prepareConn(
						opts.params,
						opts.req?.raw,
					);

					let conn: AnyConn | undefined;
					return {
						onOpen: async (ws) => {
							// Save socket
							genericConnGlobalState.websockets.set(connId, ws);

							// Create connection
							conn = await worker.createConn(
								connId,
								connToken,
								opts.params,
								connState,
								CONN_DRIVER_GENERIC_WEBSOCKET,
								{
									encoding: opts.encoding,
								} satisfies GenericWebSocketDriverState,
								opts.authData,
							);
						},
						onMessage: async (message) => {
							logger().debug("received message");

							if (!conn) {
								logger().warn("`conn` does not exist");
								return;
							}

							await worker.processMessage(message, conn);
						},
						onClose: async () => {
							genericConnGlobalState.websockets.delete(connId);

							if (conn) {
								worker.__removeConn(conn);
							}
						},
					};
				},
				onConnectSse: async (
					opts: ConnectSseOpts,
				): Promise<ConnectSseOutput> => {
					if (this.#workerStartedPromise)
						await this.#workerStartedPromise.promise;

					const worker = this.#worker;
					if (!worker) throw new Error("Worker should be defined");

					const connId = generateConnId();
					const connToken = generateConnToken();
					const connState = await worker.prepareConn(
						opts.params,
						opts.req?.raw,
					);

					let conn: AnyConn | undefined;
					return {
						onOpen: async (stream) => {
							// Save socket
							genericConnGlobalState.sseStreams.set(connId, stream);

							// Create connection
							conn = await worker.createConn(
								connId,
								connToken,
								opts.params,
								connState,
								CONN_DRIVER_GENERIC_SSE,
								{ encoding: opts.encoding } satisfies GenericSseDriverState,
								opts.authData,
							);
						},
						onClose: async () => {
							genericConnGlobalState.sseStreams.delete(connId);

							if (conn) {
								worker.__removeConn(conn);
							}
						},
					};
				},
				onAction: async (opts: ActionOpts): Promise<ActionOutput> => {
					let conn: AnyConn | undefined;
					try {
						// Wait for init to finish
						if (this.#workerStartedPromise)
							await this.#workerStartedPromise.promise;

						const worker = this.#worker;
						if (!worker) throw new Error("Worker should be defined");

						// Create conn
						const connState = await worker.prepareConn(
							opts.params,
							opts.req?.raw,
						);
						conn = await worker.createConn(
							generateConnId(),
							generateConnToken(),
							opts.params,
							connState,
							CONN_DRIVER_GENERIC_HTTP,
							{} satisfies GenericHttpDriverState,
							opts.authData,
						);

						// Call action
						const ctx = new ActionContext(worker.workerContext!, conn!);
						const output = await worker.executeAction(
							ctx,
							opts.actionName,
							opts.actionArgs,
						);

						return { output };
					} finally {
						if (conn) {
							this.#worker?.__removeConn(conn);
						}
					}
				},
				onConnMessage: async (opts: ConnsMessageOpts): Promise<void> => {
					// Wait for init to finish
					if (this.#workerStartedPromise)
						await this.#workerStartedPromise.promise;

					const worker = this.#worker;
					if (!worker) throw new Error("Worker should be defined");

					// Find connection
					const conn = worker.conns.get(opts.connId);
					if (!conn) {
						throw new errors.ConnNotFound(opts.connId);
					}

					// Authenticate connection
					if (conn._token !== opts.connToken) {
						throw new errors.IncorrectConnToken();
					}

					// Process message
					await worker.processMessage(opts.message, conn);
				},
			},
			// onConnectInspector: async () => {
			// 	if (this.#workerStartedPromise)
			// 		await this.#workerStartedPromise.promise;
			//
			// 	const worker = this.#worker;
			// 	if (!worker) throw new Error("Worker should be defined");
			//
			// 	let conn: WorkerInspectorConnection | undefined;
			// 	return {
			// 		onOpen: async (ws) => {
			// 			conn = worker.inspector.createConnection(ws);
			// 		},
			// 		onMessage: async (message) => {
			// 			if (!conn) {
			// 				logger().warn("`conn` does not exist");
			// 				return;
			// 			}
			//
			// 			worker.inspector.processMessage(conn, message);
			// 		},
			// 		onClose: async () => {
			// 			if (conn) {
			// 				worker.inspector.removeConnection(conn);
			// 			}
			// 		},
			// 	};
			// },
		});
	}

	async start(id: string, name: string, key: WorkerKey, region: string) {
		const workerDriver = this.#runConfig.driver.worker;

		// Find worker prototype
		const definition = this.#registryConfig.workers[name];
		// TODO: Handle error here gracefully somehow
		if (!definition)
			throw new Error(`no worker in registry for name ${definition}`);

		// Create worker
		this.#worker = definition.instantiate();

		// Start worker
		await this.#worker.start(
			this.#connDrivers,
			workerDriver,
			id,
			name,
			key,
			region,
		);

		this.#workerStartedPromise?.resolve();
		this.#workerStartedPromise = undefined;
	}
}
