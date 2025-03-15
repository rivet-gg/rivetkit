import { serveSse } from "./router/sse";
import { serveWebSocket } from "./router/websocket";
import { Node } from "./node/mod";
import type { ActorPeer } from "./actor-peer";
import * as errors from "@/actor/errors";
import * as events from "node:events";
import { publishMessageToLeader } from "./node/message";
import type { RelayConnection } from "./conn/mod";
import type { Hono } from "hono";
import { createActorRouter } from "@/actor/router";
import { Manager } from "@/manager/manager";
import { handleRouteError, handleRouteNotFound } from "@/common/router";
import { DriverConfig } from "@/driver-helpers/config";
import { AppConfig } from "@/app/config";

export interface GlobalState {
	nodeId: string;
	/** Actors currently running on this instance. */
	actorPeers: Map<string, ActorPeer>;
	/** Connections that are connected to this node. */
	relayConnections: Map<string, RelayConnection>;
	/** Resolvers for when a message is acknowledged by the peer. */
	messageAckResolvers: Map<string, () => void>;
}

export class CoordinateTopology {
	public readonly router: Hono;

	constructor(appConfig: AppConfig, driverConfig: DriverConfig) {
		if (!driverConfig.drivers) throw new Error("config.drivers not defined.");
		const { actor: actorDriver, coordinate: CoordinateDriver } = driverConfig.drivers;
		if (!actorDriver) throw new Error("config.drivers.actor not defined.");
		if (!CoordinateDriver)
			throw new Error("config.drivers.coordinate not defined.");

		// Allow usage of a lot of AbortSignals (which are EventEmitters)
		//events.defaultMaxListeners = 100_000;
		events.setMaxListeners(100_000);

		const globalState: GlobalState = {
			nodeId: crypto.randomUUID(),
			actorPeers: new Map(),
			relayConnections: new Map(),
			messageAckResolvers: new Map(),
		};

		const node = new Node(CoordinateDriver, globalState);
		node.start();

		const manager = new Manager(appConfig, driverConfig);

		// Build router
		const app = manager.router;

		// Forward requests to actor
		const actorRouter = createActorRouter(appConfig, driverConfig, {
			upgradeWebSocket: driverConfig.getUpgradeWebSocket?.(app),
			onConnectWebSocket: async (opts) => {
				const actorId = opts.req.param("actorId");
				if (!actorId) throw new errors.InternalError("Missing actor ID");
				return await serveWebSocket(
					appConfig,
					driverConfig,
					actorDriver,
					CoordinateDriver,
					globalState,
					actorId,
					opts,
				);
			},
			onConnectSse: async (opts) => {
				const actorId = opts.req.param("actorId");
				if (!actorId) throw new errors.InternalError("Missing actor ID");
				return await serveSse(
					appConfig,
					driverConfig,
					actorDriver,
					CoordinateDriver,
					globalState,
					actorId,
					opts,
				);
			},
			onRpc: async () => {
				// TODO:
				throw new errors.InternalError("UNIMPLEMENTED");
			},
			onConnectionsMessage: async ({ req, connId, connToken, message }) => {
				const actorId = req.param("actorId");
				if (!actorId) throw new errors.InternalError("Missing actor ID");

				await publishMessageToLeader(
					appConfig,
					driverConfig,
					CoordinateDriver,
					globalState,
					actorId,
					{
						b: {
							lm: {
								ai: actorId,
								ci: connId,
								ct: connToken,
								m: message,
							},
						},
					},
					req.raw.signal,
				);
			},
			onConnectInspector: async () => {
				throw new errors.Unsupported("inspect");
			},
		});

		app.route("/actors/:actorId", actorRouter);

		app.notFound(handleRouteNotFound);
		app.onError(handleRouteError);

		this.router = app;
	}
}
