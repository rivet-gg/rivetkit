import type { Hono } from "hono";
import invariant from "invariant";
import type { WebSocket } from "ws";
import { ActionContext } from "@/actor/action";
import {
	type AnyConn,
	generateConnId,
	generateConnToken,
} from "@/actor/connection";
import type { ConnDriver } from "@/actor/driver";
import * as errors from "@/actor/errors";
import type { AnyActorInstance } from "@/actor/instance";
import type { ActorKey } from "@/actor/mod";
import type {
	ActionOpts,
	ActionOutput,
	ConnectSseOpts,
	ConnectSseOutput,
	ConnectWebSocketOpts,
	ConnectWebSocketOutput,
	ConnsMessageOpts,
} from "@/actor/router-endpoints";
import {
	type Client,
	type ClientDriver,
	createClientWithDriver,
} from "@/client/client";
import { createInlineClientDriver } from "@/inline-client-driver/mod";
import { createManagerRouter } from "@/manager/router";
import type { RegistryConfig } from "@/registry/config";
import type { Registry } from "@/registry/mod";
import type { RunConfig } from "@/registry/run-config";
import { createActorRouter } from "@/topologies/partition/actor-router";
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
import { logger } from "./log";

export type SendRequestHandler = (
	actorRequest: Request,
	actorId: string,
) => Promise<Response>;

export type OpenWebSocketHandler = (
	path: string,
	actorId: string,
) => Promise<WebSocket>;

export class PartitionTopologyManager {
	clientDriver: ClientDriver;
	inlineClient: Client<Registry<any>>;
	router: Hono;

	constructor(registryConfig: RegistryConfig, runConfig: RunConfig) {
		const routingHandler = runConfig.driver.manager.connRoutingHandler;
		invariant(
			routingHandler,
			"partition run config must provide custom routing handler",
		);

		const managerDriver = runConfig.driver.manager;
		invariant(managerDriver, "missing manager driver");
		this.clientDriver = createInlineClientDriver(managerDriver, routingHandler);
		this.inlineClient = createClientWithDriver(this.clientDriver);

		const { router } = createManagerRouter(
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
		this.router = router;
	}
}

/** Manages the actor in the topology. */
export class PartitionTopologyActor {
	clientDriver: ClientDriver;
	inlineClient: Client<Registry<any>>;
	router: Hono;

	#registryConfig: RegistryConfig;
	#runConfig: RunConfig;
	#connDrivers: Record<string, ConnDriver>;
	#actor?: AnyActorInstance;

	get actor(): AnyActorInstance {
		if (!this.#actor) throw new Error("Actor not loaded");
		return this.#actor;
	}

	/**
	 * Promise used to wait until the actor is started. All network requests wait on this promise in order to ensure they're not accessing the actor before initialize.
	 **/
	#actorStartedPromise?: PromiseWithResolvers<void> = Promise.withResolvers();

	constructor(registryConfig: RegistryConfig, runConfig: RunConfig) {
		this.#registryConfig = registryConfig;
		this.#runConfig = runConfig;

		const routingHandler = runConfig.driver.manager.connRoutingHandler;
		invariant(
			routingHandler,
			"partition run config must provide custom routing handler",
		);

		const managerDriver = runConfig.driver.manager;
		invariant(managerDriver, "missing manager driver");
		this.clientDriver = createInlineClientDriver(managerDriver, routingHandler);
		this.inlineClient = createClientWithDriver(this.clientDriver);

		const genericConnGlobalState = new GenericConnGlobalState();
		this.#connDrivers = createGenericConnDrivers(genericConnGlobalState);

		// TODO: Store this actor router globally so we're not re-initializing it for every DO
		this.router = createActorRouter(registryConfig, runConfig, {
			getActorId: async () => {
				if (this.#actorStartedPromise) await this.#actorStartedPromise.promise;
				return this.actor.id;
			},
			connectionHandlers: {
				onConnectWebSocket: async (
					opts: ConnectWebSocketOpts,
				): Promise<ConnectWebSocketOutput> => {
					if (this.#actorStartedPromise)
						await this.#actorStartedPromise.promise;

					const actor = this.#actor;
					if (!actor) throw new Error("Actor should be defined");

					const connId = generateConnId();
					const connToken = generateConnToken();
					const connState = await actor.prepareConn(opts.params, opts.req?.raw);

					let conn: AnyConn | undefined;
					return {
						onOpen: async (ws) => {
							// Save socket
							genericConnGlobalState.websockets.set(connId, ws);

							// Create connection
							conn = await actor.createConn(
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

							await actor.processMessage(message, conn);
						},
						onClose: async () => {
							genericConnGlobalState.websockets.delete(connId);

							if (conn) {
								actor.__removeConn(conn);
							}
						},
					};
				},
				onConnectSse: async (
					opts: ConnectSseOpts,
				): Promise<ConnectSseOutput> => {
					if (this.#actorStartedPromise)
						await this.#actorStartedPromise.promise;

					const actor = this.#actor;
					if (!actor) throw new Error("Actor should be defined");

					const connId = generateConnId();
					const connToken = generateConnToken();
					const connState = await actor.prepareConn(opts.params, opts.req?.raw);

					let conn: AnyConn | undefined;
					return {
						onOpen: async (stream) => {
							// Save socket
							genericConnGlobalState.sseStreams.set(connId, stream);

							// Create connection
							conn = await actor.createConn(
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
								actor.__removeConn(conn);
							}
						},
					};
				},
				onAction: async (opts: ActionOpts): Promise<ActionOutput> => {
					let conn: AnyConn | undefined;
					try {
						// Wait for init to finish
						if (this.#actorStartedPromise)
							await this.#actorStartedPromise.promise;

						const actor = this.#actor;
						if (!actor) throw new Error("Actor should be defined");

						// Create conn
						const connState = await actor.prepareConn(
							opts.params,
							opts.req?.raw,
						);
						conn = await actor.createConn(
							generateConnId(),
							generateConnToken(),
							opts.params,
							connState,
							CONN_DRIVER_GENERIC_HTTP,
							{} satisfies GenericHttpDriverState,
							opts.authData,
						);

						// Call action
						const ctx = new ActionContext(actor.actorContext!, conn!);
						const output = await actor.executeAction(
							ctx,
							opts.actionName,
							opts.actionArgs,
						);

						return { output };
					} finally {
						if (conn) {
							this.#actor?.__removeConn(conn);
						}
					}
				},
				onConnMessage: async (opts: ConnsMessageOpts): Promise<void> => {
					// Wait for init to finish
					if (this.#actorStartedPromise)
						await this.#actorStartedPromise.promise;

					const actor = this.#actor;
					if (!actor) throw new Error("Actor should be defined");

					// Find connection
					const conn = actor.conns.get(opts.connId);
					if (!conn) {
						throw new errors.ConnNotFound(opts.connId);
					}

					// Authenticate connection
					if (conn._token !== opts.connToken) {
						throw new errors.IncorrectConnToken();
					}

					// Process message
					await actor.processMessage(opts.message, conn);
				},
			},
			// onConnectInspector: async () => {
			// 	if (this.#actorStartedPromise)
			// 		await this.#actorStartedPromise.promise;
			//
			// 	const actor = this.#actor;
			// 	if (!actor) throw new Error("Actor should be defined");
			//
			// 	let conn: ActorInspectorConnection | undefined;
			// 	return {
			// 		onOpen: async (ws) => {
			// 			conn = actor.inspector.createConnection(ws);
			// 		},
			// 		onMessage: async (message) => {
			// 			if (!conn) {
			// 				logger().warn("`conn` does not exist");
			// 				return;
			// 			}
			//
			// 			actor.inspector.processMessage(conn, message);
			// 		},
			// 		onClose: async () => {
			// 			if (conn) {
			// 				actor.inspector.removeConnection(conn);
			// 			}
			// 		},
			// 	};
			// },
		});
	}

	async start(id: string, name: string, key: ActorKey, region: string) {
		const actorDriver = this.#runConfig.driver.actor;

		// Find actor prototype
		const definition = this.#registryConfig.use[name];
		// TODO: Handle error here gracefully somehow
		if (!definition)
			throw new Error(`no actor in registry for name ${definition}`);

		// Create actor
		this.#actor = definition.instantiate();

		// Start actor
		await this.#actor.start(
			this.#connDrivers,
			actorDriver,
			this.inlineClient,
			id,
			name,
			key,
			region,
		);

		this.#actorStartedPromise?.resolve();
		this.#actorStartedPromise = undefined;
	}
}
