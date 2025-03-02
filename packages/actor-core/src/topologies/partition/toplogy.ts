import { BaseConfig } from "@/driver-helpers";
import { Manager } from "@/manager/runtime/manager";
import { Hono } from "hono";
import { createActorRouter } from "@/actor/runtime/actor_router";
import { AnyActor } from "@/actor/runtime/actor";
import * as errors from "@/actor/errors";
import {
	Connection,
	generateConnectionId,
	generateConnectionToken,
} from "@/actor/runtime/connection";
import { logger } from "./log";
import { Rpc } from "@/actor/runtime/rpc";
import {
	CONN_DRIVER_GENERIC_HTTP,
	CONN_DRIVER_GENERIC_SSE,
	CONN_DRIVER_GENERIC_WEBSOCKET,
	createGenericConnDrivers,
	GenericConnGlobalState,
	GenericHttpDriverState,
	GenericSseDriverState,
	GenericWebSocketDriverState,
} from "../common/generic_conn_driver";
import type { ConnectionDriver } from "@/actor/runtime/driver";
import type { ActorTags } from "@/common/utils";

export class PartitionTopologyManager {
	router: Hono;

	constructor(config: BaseConfig) {
		const manager = new Manager(config);
		this.router = manager.router;
	}
}

/** Manages the actor in the topology. */
export class PartitionTopologyActor {
	router: Hono;

	#config: BaseConfig;
	#connDrivers: Record<string, ConnectionDriver>;
	#actor?: AnyActor;

	get actor(): AnyActor {
		if (!this.#actor) throw new Error("Actor not loaded");
		return this.#actor;
	}

	/**
	 * Promise used to wait until the actor is started. All network requests wait on this promise in order to ensure they're not accessing the actor before initialize.
	 **/
	#actorStartedPromise?: PromiseWithResolvers<void> = Promise.withResolvers();

	constructor(config: BaseConfig) {
		this.#config = config;

		const genericConnGlobalState = new GenericConnGlobalState();
		this.#connDrivers = createGenericConnDrivers(genericConnGlobalState);

		// Build actor router
		const actorRouter = new Hono();

		// This route rhas to be mounted at the root since the root router must be passed to `upgradeWebSocket`
		actorRouter.route(
			"/",
			createActorRouter(config, {
				upgradeWebSocket: config.getUpgradeWebSocket?.(actorRouter),
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
					const connState = await actor.__prepareConnection(
						connParams,
						req.raw,
					);

					let conn: Connection<AnyActor> | undefined;
					return {
						onOpen: async (ws) => {
							// Save socket
							genericConnGlobalState.websockets.set(connId, ws);

							// Create connection
							conn = await actor.__createConnection(
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

							await actor.__processMessage(message, conn);
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
					const connState = await actor.__prepareConnection(
						connParams,
						req.raw,
					);

					let conn: Connection<AnyActor> | undefined;
					return {
						onOpen: async (stream) => {
							// Save socket
							genericConnGlobalState.sseStreams.set(connId, stream);

							// Create connection
							conn = await actor.__createConnection(
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
					let conn: Connection<AnyActor> | undefined;
					try {
						// Wait for init to finish
						if (this.#actorStartedPromise)
							await this.#actorStartedPromise.promise;

						const actor = this.#actor;
						if (!actor) throw new Error("Actor should be defined");

						// Create conn
						const connState = await actor.__prepareConnection(
							connParams,
							req.raw,
						);
						conn = await actor.__createConnection(
							generateConnectionId(),
							generateConnectionToken(),
							connParams,
							connState,
							CONN_DRIVER_GENERIC_HTTP,
							{} satisfies GenericHttpDriverState,
						);

						// Call RPC
						const ctx = new Rpc<AnyActor>(conn);
						const output = await actor.__executeRpc(ctx, rpcName, rpcArgs);

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
					const conn = actor._connections.get(connId);
					if (!conn) {
						throw new errors.ConnectionNotFound(connId);
					}

					// Authenticate connection
					if (conn._token !== connToken) {
						throw new errors.IncorrectConnectionToken();
					}

					// Process message
					await actor.__processMessage(message, conn);
				},
			}),
		);

		this.router = actorRouter;
	}

	async start(id: string, tags: ActorTags, region: string) {
		const actorDriver = this.#config.drivers?.actor;
		if (!actorDriver) throw new Error("config.drivers.actor not defined.");

		// Find actor prototype
		const actorName = tags.name;
		const prototype = this.#config.actors[actorName];
		// TODO: Handle error here gracefully somehow
		if (!prototype) throw new Error(`no actor for name ${prototype}`);

		// Create actor
		this.#actor = new prototype();

		// Start actor
		await this.#actor.__start(this.#connDrivers, actorDriver, id, tags, region);

		this.#actorStartedPromise?.resolve();
		this.#actorStartedPromise = undefined;
	}
}
