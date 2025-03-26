import { serveSse } from "./router/sse";
import { serveWebSocket } from "./router/websocket";
import { Node } from "./node/mod";
import type { ActorPeer } from "./actor-peer";
import * as errors from "@/actor/errors";
import * as events from "node:events";
import { publishMessageToLeader } from "./node/message";
import type { RelayConn } from "./conn/mod";
import { Hono } from "hono";
import { createActorRouter } from "@/actor/router";
import { handleRouteError, handleRouteNotFound } from "@/common/router";
import type { DriverConfig } from "@/driver-helpers/config";
import type { AppConfig } from "@/app/config";
import { createManagerRouter } from "@/manager/router";

export interface GlobalState {
	nodeId: string;
	/** Actors currently running on this instance. */
	actorPeers: Map<string, ActorPeer>;
	/** Connections that are connected to this node. */
	relayConns: Map<string, RelayConn>;
	/** Resolvers for when a message is acknowledged by the peer. */
	messageAckResolvers: Map<string, () => void>;
}

export class CoordinateTopology {
	public readonly router: Hono;

	constructor(appConfig: AppConfig, driverConfig: DriverConfig) {
		if (!driverConfig.drivers) throw new Error("config.drivers not defined.");
		const { actor: actorDriver, coordinate: CoordinateDriver } =
			driverConfig.drivers;
		if (!actorDriver) throw new Error("config.drivers.actor not defined.");
		if (!CoordinateDriver)
			throw new Error("config.drivers.coordinate not defined.");

		// Allow usage of a lot of AbortSignals (which are EventEmitters)
		//events.defaultMaxListeners = 100_000;
		events.setMaxListeners(100_000);

		const globalState: GlobalState = {
			nodeId: crypto.randomUUID(),
			actorPeers: new Map(),
			relayConns: new Map(),
			messageAckResolvers: new Map(),
		};

		const node = new Node(CoordinateDriver, globalState);
		node.start();

		// Build app
		const app = new Hono();

		const upgradeWebSocket = driverConfig.getUpgradeWebSocket?.(app);

		// Build manager router
		const managerRouter = createManagerRouter(appConfig, driverConfig, {
			upgradeWebSocket,
			onConnectInspector: () => {
				throw new errors.Unsupported("inspect");
			},
		});

		// Forward requests to actor
		const actorRouter = createActorRouter(appConfig, driverConfig, {
			upgradeWebSocket,
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
			onConnMessage: async ({ req, connId, connToken, message }) => {
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

		app.route("/", managerRouter);
		app.route("/actors/:actorId", actorRouter);

		app.notFound(handleRouteNotFound);
		app.onError(handleRouteError);

		this.router = app;
	}
}
