import { Manager } from "@/manager/manager";
import { Hono } from "hono";
import { createActorRouter } from "@/actor/router";
import { AnyActorInstance } from "@/actor/instance";
import * as errors from "@/actor/errors";
import {
    AnyConnection,
	Connection,
	generateConnectionId,
	generateConnectionToken,
} from "@/actor/connection";
import { logger } from "./log";
import { RpcContext } from "@/actor/rpc";
import {
	CONN_DRIVER_GENERIC_HTTP,
	CONN_DRIVER_GENERIC_SSE,
	CONN_DRIVER_GENERIC_WEBSOCKET,
	createGenericConnDrivers,
	GenericConnGlobalState,
	GenericHttpDriverState,
	GenericSseDriverState,
	GenericWebSocketDriverState,
} from "../common/generic-conn-driver";
import type { ConnectionDriver } from "@/actor/driver";
import type { ActorTags } from "@/common/utils";
import { InspectorConnection } from "@/actor/inspect";
import { DriverConfig } from "@/driver-helpers/config";
import { AppConfig } from "@/app/config";

export class PartitionTopologyManager {
	router: Hono;

	constructor(appConfig: AppConfig, driverConfig: DriverConfig) {
		const manager = new Manager(appConfig, driverConfig);
		this.router = manager.router;
	}
}

/** Manages the actor in the topology. */
export class PartitionTopologyActor {
	router: Hono;

	#appConfig: AppConfig;
	#driverConfig: DriverConfig;
	#connDrivers: Record<string, ConnectionDriver>;
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

		// Build actor router
		const actorRouter = new Hono();

		// This route rhas to be mounted at the root since the root router must be passed to `upgradeWebSocket`
		actorRouter.route(
			"/",
			createActorRouter(appConfig, driverConfig, {
				upgradeWebSocket: driverConfig.getUpgradeWebSocket?.(actorRouter),
				onConnectWebSocket: async ({
					req,
					encoding,
					parameters: connParams,
				}) => {
					if (this.#actorStartedPromise)
						await this.#actorStartedPromise.promise;

					const actor = this.#actor;
					if (!actor) throw new Error("Actor should be defined");

					const connId = generateConnectionId();
					const connToken = generateConnectionToken();
					const connState = await actor.pepareConnection(
						connParams,
						req.raw,
					);

					let conn: AnyConnection | undefined;
					return {
						onOpen: async (ws) => {
							// Save socket
							genericConnGlobalState.websockets.set(connId, ws);

							// Create connection
							conn = await actor.createConnection(
								connId,
								connToken,

								connParams,
								connState,
								CONN_DRIVER_GENERIC_WEBSOCKET,
								{ encoding } satisfies GenericWebSocketDriverState,
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
								actor.__removeConnection(conn);
							}
						},
					};
				},
				onConnectSse: async ({ req, encoding, parameters: connParams }) => {
					if (this.#actorStartedPromise)
						await this.#actorStartedPromise.promise;

					const actor = this.#actor;
					if (!actor) throw new Error("Actor should be defined");

					const connId = generateConnectionId();
					const connToken = generateConnectionToken();
					const connState = await actor.pepareConnection(
						connParams,
						req.raw,
					);

					let conn: AnyConnection | undefined;
					return {
						onOpen: async (stream) => {
							// Save socket
							genericConnGlobalState.sseStreams.set(connId, stream);

							// Create connection
							conn = await actor.createConnection(
								connId,
								connToken,
								connParams,
								connState,
								CONN_DRIVER_GENERIC_SSE,
								{ encoding } satisfies GenericSseDriverState,
							);
						},
						onClose: async () => {
							genericConnGlobalState.sseStreams.delete(connId);

							if (conn) {
								actor.__removeConnection(conn);
							}
						},
					};
				},
				onRpc: async ({ req, parameters: connParams, rpcName, rpcArgs }) => {
					let conn: AnyConnection | undefined;
					try {
						// Wait for init to finish
						if (this.#actorStartedPromise)
							await this.#actorStartedPromise.promise;

						const actor = this.#actor;
						if (!actor) throw new Error("Actor should be defined");

						// Create conn
						const connState = await actor.pepareConnection(
							connParams,
							req.raw,
						);
						conn = await actor.createConnection(
							generateConnectionId(),
							generateConnectionToken(),
							connParams,
							connState,
							CONN_DRIVER_GENERIC_HTTP,
							{} satisfies GenericHttpDriverState,
						);

						// Call RPC
						const ctx = new RpcContext(actor.actorContext!, conn!);
						const output = await actor.executeRpc(ctx, rpcName, rpcArgs);

						return { output };
					} finally {
						if (conn) {
							this.#actor?.__removeConnection(conn);
						}
					}
				},
				onConnectionsMessage: async ({ connId, connToken, message }) => {
					// Wait for init to finish
					if (this.#actorStartedPromise)
						await this.#actorStartedPromise.promise;

					const actor = this.#actor;
					if (!actor) throw new Error("Actor should be defined");

					// Find connection
					const conn = actor.connections.get(connId);
					if (!conn) {
						throw new errors.ConnectionNotFound(connId);
					}

					// Authenticate connection
					if (conn._token !== connToken) {
						throw new errors.IncorrectConnectionToken();
					}

					// Process message
					await actor.processMessage(message, conn);
				},
				onConnectInspector: async () => {
					if (this.#actorStartedPromise)
						await this.#actorStartedPromise.promise;

					const actor = this.#actor;
					if (!actor) throw new Error("Actor should be defined");

					let conn: InspectorConnection | undefined;
					return {
						onOpen: async (ws) => {
							conn = actor.inspector.__createConnection(ws);
						},
						onMessage: async (message) => {
							if (!conn) {
								logger().warn("`conn` does not exist");
								return;
							}

							actor.inspector.__processMessage(conn, message);
						},
						onClose: async () => {
							if (conn) {
								actor.inspector.__removeConnection(conn);
							}
						},
					};
				},
			}),
		);

		this.router = actorRouter;
	}

	async start(id: string, name: string, tags: ActorTags, region: string) {
		const actorDriver = this.#driverConfig.drivers?.actor;
		if (!actorDriver) throw new Error("config.drivers.actor not defined.");

		// Find actor prototype
		const definition = this.#appConfig.actors[name];
		// TODO: Handle error here gracefully somehow
		if (!definition) throw new Error(`no actor in registry for name ${definition}`);

		// Create actor
		this.#actor = definition.instantiate();

		// Start actor
		await this.#actor.start(this.#connDrivers, actorDriver, id, name, tags, region);

		this.#actorStartedPromise?.resolve();
		this.#actorStartedPromise = undefined;
	}
}
