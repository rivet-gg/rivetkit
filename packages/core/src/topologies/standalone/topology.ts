import type { AnyWorkerInstance } from "@/worker/instance";
import { Hono } from "hono";
import {
	type AnyConn,
	generateConnId,
	generateConnToken,
} from "@/worker/connection";
import { logger } from "./log";
import * as errors from "@/worker/errors";
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
import { ActionContext } from "@/worker/action";
import type { RegistryConfig } from "@/registry/config";
import { createManagerRouter } from "@/manager/router";
import type {
	ConnectWebSocketOpts,
	ConnectWebSocketOutput,
	ConnectSseOpts,
	ConnectSseOutput,
	ConnsMessageOpts,
	ActionOpts,
	ActionOutput,
	ConnectionHandlers,
} from "@/worker/router-endpoints";
import { createInlineClientDriver } from "@/inline-client-driver/mod";
import invariant from "invariant";
import { ClientDriver } from "@/client/client";
import { ConnRoutingHandler } from "@/worker/conn-routing-handler";
import { DriverConfig, RunConfig } from "@/mod";

class WorkerHandler {
	/** Will be undefined if not yet loaded. */
	worker?: AnyWorkerInstance;

	/** Promise that will resolve when the worker is loaded. This should always be awaited before accessing the worker. */
	workerPromise?: PromiseWithResolvers<void> = Promise.withResolvers();

	genericConnGlobalState = new GenericConnGlobalState();
}

/**
 * Standalone topology implementation.
 * Manages workers in a single instance without distributed coordination.
 */
export class StandaloneTopology {
	clientDriver: ClientDriver;
	router: Hono;

	#registryConfig: RegistryConfig;
	#runConfig: RunConfig;
	#workers = new Map<string, WorkerHandler>();

	constructor(registryConfig: RegistryConfig, runConfig: RunConfig) {
		this.#registryConfig = registryConfig;
		this.#runConfig = runConfig;

		// Build router
		const router = new Hono();

		const routingHandler: ConnRoutingHandler = this.#createRoutingHandlers();

		// Build client driver
		const managerDriver = this.#runConfig.driver.manager;
		invariant(managerDriver, "missing manager driver");
		this.clientDriver = createInlineClientDriver(managerDriver, routingHandler);

		// Build manager router
		const { router: managerRouter } = createManagerRouter(
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

		router.route("/", managerRouter);

		this.router = router;
	}

	async #getWorker(
		workerId: string,
	): Promise<{ handler: WorkerHandler; worker: AnyWorkerInstance }> {
		// Load existing worker
		let handler = this.#workers.get(workerId);
		if (handler) {
			if (handler.workerPromise) await handler.workerPromise.promise;
			if (!handler.worker) throw new Error("Worker should be loaded");
			return { handler, worker: handler.worker };
		}

		// Create new worker
		logger().debug("creating new worker", { workerId });

		// Insert unloaded placeholder in order to prevent race conditions with multiple insertions of the worker
		handler = new WorkerHandler();
		this.#workers.set(workerId, handler);

		// Load worker meta
		const workerMetadata = await this.#runConfig.driver.manager.getForId({
			workerId,
		});
		if (!workerMetadata) throw new Error(`No worker found for ID ${workerId}`);

		// Build worker
		const definition = this.#registryConfig.workers[workerMetadata.name];
		if (!definition)
			throw new Error(`no worker in registry for name ${definition}`);

		// Create leader worker
		const worker = definition.instantiate();
		handler.worker = worker;

		// Create connection drivers
		const connDrivers = createGenericConnDrivers(
			handler.genericConnGlobalState,
		);

		// Start worker
		await handler.worker.start(
			connDrivers,
			this.#runConfig.driver.worker,
			workerId,
			workerMetadata.name,
			workerMetadata.key,
			"unknown",
		);

		// Finish
		handler.workerPromise?.resolve();
		handler.workerPromise = undefined;

		return { handler, worker };
	}

	#createRoutingHandlers(): ConnRoutingHandler {
		const handlers: ConnectionHandlers = {
			onConnectWebSocket: async (
				opts: ConnectWebSocketOpts,
			): Promise<ConnectWebSocketOutput> => {
				const { handler, worker } = await this.#getWorker(opts.workerId);

				const connId = generateConnId();
				const connToken = generateConnToken();
				const connState = await worker.prepareConn(opts.params, opts.req?.raw);

				let conn: AnyConn | undefined;
				return {
					onOpen: async (ws) => {
						// Save socket
						handler.genericConnGlobalState.websockets.set(connId, ws);

						// Create connection
						conn = await worker.createConn(
							connId,
							connToken,
							opts.params,
							connState,
							CONN_DRIVER_GENERIC_WEBSOCKET,
							{ encoding: opts.encoding } satisfies GenericWebSocketDriverState,
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
						handler.genericConnGlobalState.websockets.delete(connId);

						if (conn) {
							worker.__removeConn(conn);
						}
					},
				};
			},
			onConnectSse: async (opts: ConnectSseOpts): Promise<ConnectSseOutput> => {
				const { handler, worker } = await this.#getWorker(opts.workerId);

				const connId = generateConnId();
				const connToken = generateConnToken();
				const connState = await worker.prepareConn(opts.params, opts.req?.raw);

				let conn: AnyConn | undefined;
				return {
					onOpen: async (stream) => {
						// Save socket
						handler.genericConnGlobalState.sseStreams.set(connId, stream);

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
						handler.genericConnGlobalState.sseStreams.delete(connId);

						if (conn) {
							worker.__removeConn(conn);
						}
					},
				};
			},
			onAction: async (opts: ActionOpts): Promise<ActionOutput> => {
				let conn: AnyConn | undefined;
				try {
					const { worker } = await this.#getWorker(opts.workerId);

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
					const ctx = new ActionContext(worker.workerContext!, conn);
					const output = await worker.executeAction(
						ctx,
						opts.actionName,
						opts.actionArgs,
					);

					return { output };
				} finally {
					if (conn) {
						const { worker } = await this.#getWorker(opts.workerId);
						worker.__removeConn(conn);
					}
				}
			},
			onConnMessage: async (opts: ConnsMessageOpts): Promise<void> => {
				const { worker } = await this.#getWorker(opts.workerId);

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
		};

		return { inline: { handlers } };
	}
}
