import { Hono } from "hono";
import { createActorRouter } from "@/actor/router";
import type { AnyActorInstance } from "@/actor/instance";
import * as errors from "@/actor/errors";
import {
	type AnyConn,
	generateConnId,
	generateConnToken,
} from "@/actor/connection";
import { logger } from "./log";
import { ActionContext } from "@/actor/action";
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
import type { ConnDriver } from "@/actor/driver";
import type { ActorKey } from "@/common/utils";
import type { DriverConfig } from "@/driver-helpers/config";
import type { AppConfig } from "@/app/config";
import type { ActorInspectorConnection } from "@/inspector/actor";
import {
	createManagerRouter,
	OnProxyWebSocket,
	type OnProxyRequest,
} from "@/manager/router";
import type { ManagerInspectorConnection } from "@/inspector/manager";
import type {
	ConnectWebSocketOpts,
	ConnectSseOpts,
	RpcOpts,
	ConnsMessageOpts,
	ConnectWebSocketOutput,
	ConnectSseOutput,
	RpcOutput,
} from "@/actor/router_endpoints";

export class PartitionTopologyManager {
	router: Hono;

	constructor(
		appConfig: AppConfig,
		driverConfig: DriverConfig,
		proxyCustomConfig: {
			onProxyRequest: OnProxyRequest;
			onProxyWebSocket: OnProxyWebSocket;
		},
	) {
		this.router = createManagerRouter(appConfig, driverConfig, {
			proxyMode: {
				custom: proxyCustomConfig,
			},
			onConnectInspector: async () => {
				const inspector = driverConfig.drivers?.manager?.inspector;
				if (!inspector) throw new errors.Unsupported("inspector");

				let conn: ManagerInspectorConnection | undefined;
				return {
					onOpen: async (ws) => {
						conn = inspector.createConnection(ws);
					},
					onMessage: async (message) => {
						if (!conn) {
							logger().warn("`conn` does not exist");
							return;
						}

						inspector.processMessage(conn, message);
					},
					onClose: async () => {
						if (conn) {
							inspector.removeConnection(conn);
						}
					},
				};
			},
		});
	}
}

/** Manages the actor in the topology. */
export class PartitionTopologyActor {
	router: Hono;

	#appConfig: AppConfig;
	#driverConfig: DriverConfig;
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

	constructor(appConfig: AppConfig, driverConfig: DriverConfig) {
		this.#appConfig = appConfig;
		this.#driverConfig = driverConfig;

		const genericConnGlobalState = new GenericConnGlobalState();
		this.#connDrivers = createGenericConnDrivers(genericConnGlobalState);

		// TODO: Store this actor router globally so we're not re-initializing it for every DO
		this.router = createActorRouter(appConfig, driverConfig, {
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
					const connState = await actor.prepareConn(opts.params, opts.req.raw);

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
					const connState = await actor.prepareConn(opts.params, opts.req.raw);

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
				onRpc: async (opts: RpcOpts): Promise<RpcOutput> => {
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
							opts.req.raw,
						);
						conn = await actor.createConn(
							generateConnId(),
							generateConnToken(),
							opts.params,
							connState,
							CONN_DRIVER_GENERIC_HTTP,
							{} satisfies GenericHttpDriverState,
						);

						// Call RPC
						const ctx = new ActionContext(actor.actorContext!, conn!);
						const output = await actor.executeRpc(
							ctx,
							opts.rpcName,
							opts.rpcArgs,
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
			onConnectInspector: async () => {
				if (this.#actorStartedPromise) await this.#actorStartedPromise.promise;

				const actor = this.#actor;
				if (!actor) throw new Error("Actor should be defined");

				let conn: ActorInspectorConnection | undefined;
				return {
					onOpen: async (ws) => {
						conn = actor.inspector.createConnection(ws);
					},
					onMessage: async (message) => {
						if (!conn) {
							logger().warn("`conn` does not exist");
							return;
						}

						actor.inspector.processMessage(conn, message);
					},
					onClose: async () => {
						if (conn) {
							actor.inspector.removeConnection(conn);
						}
					},
				};
			},
		});
	}

	async start(id: string, name: string, key: ActorKey, region: string) {
		const actorDriver = this.#driverConfig.drivers?.actor;
		if (!actorDriver) throw new Error("config.drivers.actor not defined.");

		// Find actor prototype
		const definition = this.#appConfig.actors[name];
		// TODO: Handle error here gracefully somehow
		if (!definition)
			throw new Error(`no actor in registry for name ${definition}`);

		// Create actor
		this.#actor = definition.instantiate();

		// Start actor
		await this.#actor.start(
			this.#connDrivers,
			actorDriver,
			id,
			name,
			key,
			region,
		);

		this.#actorStartedPromise?.resolve();
		this.#actorStartedPromise = undefined;
	}
}
