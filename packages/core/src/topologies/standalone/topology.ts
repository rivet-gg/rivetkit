import { Hono } from "hono";
import invariant from "invariant";
import { ActionContext } from "@/actor/action";
import type { ConnRoutingHandler } from "@/actor/conn-routing-handler";
import {
	type AnyConn,
	generateConnId,
	generateConnToken,
} from "@/actor/connection";
import * as errors from "@/actor/errors";
import type { AnyActorInstance } from "@/actor/instance";
import type {
	ActionOpts,
	ActionOutput,
	ConnectionHandlers,
	ConnectSseOpts,
	ConnectSseOutput,
	ConnectWebSocketOpts,
	ConnectWebSocketOutput,
	ConnsMessageOpts,
	FetchOpts,
	WebSocketOpts,
} from "@/actor/router-endpoints";
import {
	type Client,
	type ClientDriver,
	createClientWithDriver,
} from "@/client/client";
import { createInlineClientDriver } from "@/inline-client-driver/mod";
import { createManagerRouter } from "@/manager/router";
import type { Registry, RunConfig } from "@/mod";
import type { RegistryConfig } from "@/registry/config";
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
	clientDriver: ClientDriver;
	inlineClient: Client<Registry<any>>;
	router: Hono;

	#registryConfig: RegistryConfig;
	#runConfig: RunConfig;
	#actors = new Map<string, ActorHandler>();

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
		this.inlineClient = createClientWithDriver(this.clientDriver);

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

		// Load actor meta
		const actorMetadata = await this.#runConfig.driver.manager.getForId({
			actorId,
		});
		if (!actorMetadata) throw new Error(`No actor found for ID ${actorId}`);

		// Build actor
		const definition = this.#registryConfig.use[actorMetadata.name];
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
			this.#runConfig.driver.actor,
			this.inlineClient,
			actorId,
			actorMetadata.name,
			actorMetadata.key,
			"unknown",
		);

		// Finish
		handler.actorPromise?.resolve();
		handler.actorPromise = undefined;

		return { handler, actor };
	}

	#createRoutingHandlers(): ConnRoutingHandler {
		const handlers: ConnectionHandlers = {
			onConnectWebSocket: async (
				opts: ConnectWebSocketOpts,
			): Promise<ConnectWebSocketOutput> => {
				const { handler, actor } = await this.#getActor(opts.actorId);

				const connId = generateConnId();
				const connToken = generateConnToken();
				const connState = await actor.prepareConn(opts.params, opts.req?.raw);

				let conn: AnyConn | undefined;
				return {
					onOpen: async (ws) => {
						// Save socket
						handler.genericConnGlobalState.websockets.set(connId, ws);

						// Create connection
						conn = await actor.createConn(
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
			onConnectSse: async (opts: ConnectSseOpts): Promise<ConnectSseOutput> => {
				const { handler, actor } = await this.#getActor(opts.actorId);

				const connId = generateConnId();
				const connToken = generateConnToken();
				const connState = await actor.prepareConn(opts.params, opts.req?.raw);

				let conn: AnyConn | undefined;
				return {
					onOpen: async (stream) => {
						// Save socket
						handler.genericConnGlobalState.sseStreams.set(connId, stream);

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
						handler.genericConnGlobalState.sseStreams.delete(connId);

						if (conn) {
							actor.__removeConn(conn);
						}
					},
				};
			},
			onAction: async (opts: ActionOpts): Promise<ActionOutput> => {
				let conn: AnyConn | undefined;
				try {
					const { actor } = await this.#getActor(opts.actorId);

					// Create conn
					const connState = await actor.prepareConn(opts.params, opts.req?.raw);
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
					const ctx = new ActionContext(actor.actorContext!, conn);
					const output = await actor.executeAction(
						ctx,
						opts.actionName,
						opts.actionArgs,
					);

					return { output };
				} finally {
					if (conn) {
						const { actor } = await this.#getActor(opts.actorId);
						actor.__removeConn(conn);
					}
				}
			},
			onConnMessage: async (opts: ConnsMessageOpts): Promise<void> => {
				const { actor } = await this.#getActor(opts.actorId);

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
			onFetch: async (opts: FetchOpts): Promise<Response> => {
				const { actor } = await this.#getActor(opts.actorId);

				// Call the actor's onFetch handler - it will throw appropriate errors
				const response = await actor.handleFetch(opts.request);

				// This should never happen now since handleFetch throws errors
				if (!response) {
					throw new errors.InternalError(
						"handleFetch returned void unexpectedly",
					);
				}

				return response;
			},
			onWebSocket: async (opts: WebSocketOpts): Promise<void> => {
				const { actor } = await this.#getActor(opts.actorId);

				// Call the actor's onWebSocket handler
				await actor.handleWebSocket(opts.websocket, opts.request);
			},
		};

		return {
			inline: {
				handlers,
				getActorInstance: async (actorId: string) => {
					const handler = this.#actors.get(actorId);
					if (!handler) {
						return undefined;
					}
					await handler.actorPromise?.promise;
					return handler.actor;
				},
			},
		};
	}
}
