import type { AnyActorInstance } from "@/actor/instance";
import { Hono } from "hono";
import {
	type AnyConn,
	generateConnId,
	generateConnToken,
} from "@/actor/connection";
import { createActorRouter } from "@/actor/router";
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
} from "../common/generic-conn-driver";
import { ActionContext } from "@/actor/action";
import type { DriverConfig } from "@/driver-helpers/config";
import type { AppConfig } from "@/app/config";
import { createManagerRouter } from "@/manager/router";
import type { ActorInspectorConnection } from "@/inspector/actor";
import type { ManagerInspectorConnection } from "@/inspector/manager";

class ActorHandler {
	/** Will be undefined if not yet loaded. */
	actor?: AnyActorInstance;

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

	#appConfig: AppConfig;
	#driverConfig: DriverConfig;
	#actors = new Map<string, ActorHandler>();

	async #getActor(
		actorId: string,
	): Promise<{ handler: ActorHandler; actor: AnyActorInstance }> {
		// Load existing actor
		let handler = this.#actors.get(actorId);
		if (handler) {
			if (handler.actorPromise) await handler.actorPromise.promise;
			if (!handler.actor) throw new Error("Actor should be loaded");
			return { handler, actor: handler.actor };
		}

		// Create new actor
		logger().debug("creating new actor", { actorId });

		// Insert unloaded placeholder in order to prevent race conditions with multiple insertions of the actor
		handler = new ActorHandler();
		this.#actors.set(actorId, handler);

		// Validate config
		if (!this.#driverConfig.drivers?.actor)
			throw new Error("config.drivers.actor is not defined.");
		if (!this.#driverConfig.drivers?.manager)
			throw new Error("config.drivers.manager is not defined.");

		// Load actor meta
		const actorMetadata = await this.#driverConfig.drivers.manager.getForId({
			// HACK: The endpoint doesn't matter here, so we're passing a bogon IP
			baseUrl: "http://192.0.2.0",
			actorId,
		});
		if (!actorMetadata) throw new Error(`No actor found for ID ${actorId}`);

		// Build actor
		const definition = this.#appConfig.actors[actorMetadata.name];
		if (!definition)
			throw new Error(`no actor in registry for name ${definition}`);

		// Create leader actor
		const actor = definition.instantiate();
		handler.actor = actor;

		// Create connection drivers
		const connDrivers = createGenericConnDrivers(
			handler.genericConnGlobalState,
		);

		// Start actor
		await handler.actor.start(
			connDrivers,
			this.#driverConfig.drivers.actor,
			actorId,
			actorMetadata.name,
			actorMetadata.tags,
			"unknown",
		);

		// Finish
		handler.actorPromise?.resolve();
		handler.actorPromise = undefined;

		return { handler, actor };
	}

	constructor(appConfig: AppConfig, driverConfig: DriverConfig) {
		this.#appConfig = appConfig;
		this.#driverConfig = driverConfig;

		if (!driverConfig.drivers?.actor)
			throw new Error("config.drivers.actor not defined.");

		// Build router
		const app = new Hono();

		const upgradeWebSocket = driverConfig.getUpgradeWebSocket?.(app);

		// Build manager router
		const managerRouter = createManagerRouter(appConfig, driverConfig, {
			upgradeWebSocket,
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

		// Build actor router
		const actorRouter = createActorRouter(appConfig, driverConfig, {
			upgradeWebSocket,
			onConnectWebSocket: async ({ req, encoding, params: connParams }) => {
				const actorId = req.param("actorId");
				if (!actorId) throw new errors.InternalError("Missing actor ID");

				const { handler, actor } = await this.#getActor(actorId);

				const connId = generateConnId();
				const connToken = generateConnToken();
				const connState = await actor.prepareConn(connParams, req.raw);

				let conn: AnyConn | undefined;
				return {
					onOpen: async (ws) => {
						// Save socket
						handler.genericConnGlobalState.websockets.set(connId, ws);

						// Create connection
						conn = await actor.createConn(
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
						handler.genericConnGlobalState.websockets.delete(connId);

						if (conn) {
							actor.__removeConn(conn);
						}
					},
				};
			},
			onConnectSse: async ({ req, encoding, params: connParams }) => {
				const actorId = req.param("actorId");
				if (!actorId) throw new errors.InternalError("Missing actor ID");

				const { handler, actor } = await this.#getActor(actorId);

				const connId = generateConnId();
				const connToken = generateConnToken();
				const connState = await actor.prepareConn(connParams, req.raw);

				let conn: AnyConn | undefined;
				return {
					onOpen: async (stream) => {
						// Save socket
						handler.genericConnGlobalState.sseStreams.set(connId, stream);

						// Create connection
						conn = await actor.createConn(
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
							actor.__removeConn(conn);
						}
					},
				};
			},
			onRpc: async ({ req, params: connParams, rpcName, rpcArgs }) => {
				const actorId = req.param("actorId");
				if (!actorId) throw new errors.InternalError("Missing actor ID");

				let conn: AnyConn | undefined;
				try {
					const { actor } = await this.#getActor(actorId);

					// Create conn
					const connState = await actor.prepareConn(connParams, req.raw);
					conn = await actor.createConn(
						generateConnId(),
						generateConnToken(),
						connParams,
						connState,
						CONN_DRIVER_GENERIC_HTTP,
						{} satisfies GenericHttpDriverState,
					);

					// Call RPC
					const ctx = new ActionContext(actor.actorContext!, conn);
					const output = await actor.executeRpc(ctx, rpcName, rpcArgs);

					return { output };
				} finally {
					if (conn) {
						const { actor } = await this.#getActor(actorId);
						actor.__removeConn(conn);
					}
				}
			},
			onConnMessage: async ({ req, connId, connToken, message }) => {
				const actorId = req.param("actorId");
				if (!actorId) throw new errors.InternalError("Missing actor ID");

				const { actor } = await this.#getActor(actorId);

				// Find connection
				const conn = actor.conns.get(connId);
				if (!conn) {
					throw new errors.ConnNotFound(connId);
				}

				// Authenticate connection
				if (conn._token !== connToken) {
					throw new errors.IncorrectConnToken();
				}

				// Process message
				await actor.processMessage(message, conn);
			},
			onConnectInspector: async ({ req }) => {
				const actorId = req.param("actorId");
				if (!actorId) throw new errors.InternalError("Missing actor ID");

				const { actor } = await this.#getActor(actorId);

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

		app.route("/", managerRouter);
		// Mount the actor router
		app.route("/actors/:actorId", actorRouter);

		this.router = app;
	}
}
