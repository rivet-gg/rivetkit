import type { AnyActor } from "@/actor/runtime/actor";
import type { BaseConfig } from "@/actor/runtime/config";
import type { Hono } from "hono";
import {
	type Connection,
	generateConnectionId,
	generateConnectionToken,
} from "@/actor/runtime/connection";
import { createActorRouter } from "@/actor/runtime/actor_router";
import { Manager } from "@/manager/runtime/manager";
import { logger } from "./log";
import * as errors from "@/actor/errors";
import {
	CONN_DRIVER_GENERIC_HTTP,
	CONN_DRIVER_GENERIC_SSE,
	CONN_DRIVER_GENERIC_WEBSOCKET,
	createGenericConnDrivers,
	GenericConnGlobalState,
	type GenericHttpDriverState,
	type GenericSseDriverState,
	type GenericWebSocketDriverState,
} from "../common/generic_conn_driver";
import { Rpc } from "@/actor/runtime/rpc";

class ActorHandler {
	/** Will be undefined if not yet loaded. */
	actor?: AnyActor;

	/** Promise that will resolve when the actor is loaded. This should always be awaited before accessing the actor. */
	actorPromise?: PromiseWithResolvers<void> = Promise.withResolvers();

	genericConnGlobalState = new GenericConnGlobalState();
}

/**
 * Standalone topology implementation.
 * Manages actors in a single instance without distributed coordination.
 */
export class StandaloneTopology {
	/**
	 * The router instance.
	 */
	readonly router: Hono;

	#config: BaseConfig;
	#actors = new Map<string, ActorHandler>();

	async #getActor(
		actorId: string,
	): Promise<{ handler: ActorHandler; actor: AnyActor }> {
		// Load existing actor
		let handler = this.#actors.get(actorId);
		if (handler) {
			if (handler.actorPromise) await handler.actorPromise.promise;
			if (!handler.actor) throw new Error("Acotr should be loaded");
			return { handler, actor: handler.actor };
		}

		// Create new actor
		logger().debug("creating new actor", { actorId });

		// Insert unloaded placeholder in order to prevent race conditions with multiple insertions of the actor
		handler = new ActorHandler();
		this.#actors.set(actorId, handler);

		// Validate config
		if (!this.#config.drivers?.actor)
			throw new Error("config.drivers.actor is not defined.");
		if (!this.#config.drivers?.manager)
			throw new Error("config.drivers.manager is not defined.");

		// Load actor meta
		const actorMetadata = await this.#config.drivers.manager.getForId({
			// HACK: The endpoint doesn't matter here, so we're passing a bogon IP
			origin: "http://192.0.2.0",
			actorId,
		});
		if (!actorMetadata) throw new Error(`No actor found for ID ${actorId}`);

		// Build actor
		const actorName = actorMetadata.tags.name;
		const prototype = this.#config.actors[actorName];
		if (!prototype) throw new Error(`no actor for name ${prototype}`);

		// Create leader actor
		const actor = new prototype();
		handler.actor = actor;

		// Create connection drivers
		const connDrivers = createGenericConnDrivers(
			handler.genericConnGlobalState,
		);

		// Start actor
		await handler.actor.__start(
			connDrivers,
			this.#config.drivers.actor,
			actorId,
			actorMetadata.tags,
			"unknown",
		);

		// Finish
		handler.actorPromise?.resolve();
		handler.actorPromise = undefined;

		return { handler, actor };
	}

	constructor(config: BaseConfig) {
		this.#config = config;

		if (!config.drivers?.actor)
			throw new Error("config.drivers.actor not defined.");

		// Create manager
		const manager = new Manager(config);

		// Build router
		const app = manager.router;

		// Build actor router
		const actorRouter = createActorRouter(config, {
			upgradeWebSocket: config.router?.getUpgradeWebSocket?.(app),
			onConnectWebSocket: async ({ req, encoding, parameters: connParams }) => {
				const actorId = req.param("actorId");
				if (!actorId) throw new errors.InternalError("Missing actor ID");

				const { handler, actor } = await this.#getActor(actorId);

				const connId = generateConnectionId();
				const connToken = generateConnectionToken();
				const connState = await actor.__prepareConnection(connParams, req.raw);

				let conn: Connection<AnyActor> | undefined;
				return {
					onOpen: async (ws) => {
						// Save socket
						handler.genericConnGlobalState.websockets.set(connId, ws);

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
						handler.genericConnGlobalState.websockets.delete(connId);

						if (conn) {
							actor.__removeConnection(conn);
						}
					},
				};
			},
			onConnectSse: async ({ req, encoding, parameters: connParams }) => {
				const actorId = req.param("actorId");
				if (!actorId) throw new errors.InternalError("Missing actor ID");

				const { handler, actor } = await this.#getActor(actorId);

				const connId = generateConnectionId();
				const connToken = generateConnectionToken();
				const connState = await actor.__prepareConnection(connParams, req.raw);

				let conn: Connection<AnyActor> | undefined;
				return {
					onOpen: async (stream) => {
						// Save socket
						handler.genericConnGlobalState.sseStreams.set(connId, stream);

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
						handler.genericConnGlobalState.sseStreams.delete(connId);

						if (conn) {
							actor.__removeConnection(conn);
						}
					},
				};
			},
			onRpc: async ({ req, parameters: connParams, rpcName, rpcArgs }) => {
				const actorId = req.param("actorId");
				if (!actorId) throw new errors.InternalError("Missing actor ID");

				let conn: Connection<AnyActor> | undefined;
				try {
					const { actor } = await this.#getActor(actorId);

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
						const { actor } = await this.#getActor(actorId);
						actor.__removeConnection(conn);
					}
				}
			},
			onConnectionsMessage: async ({ req, connId, connToken, message }) => {
				const actorId = req.param("actorId");
				if (!actorId) throw new errors.InternalError("Missing actor ID");

				const { actor } = await this.#getActor(actorId);

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
		});

		// Mount the actor router
		app.route("/actors/:actorId", actorRouter);

		this.router = app;
	}
}
