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
import type {
	ConnectWebSocketOpts,
	ConnectSseOpts,
	ActionOpts,
	ConnsMessageOpts,
	ConnectWebSocketOutput,
	ConnectSseOutput,
	ActionOutput,
	ConnectionHandlers,
} from "@/actor/router-endpoints";

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

		// Share connection handlers for both routers
		const connectionHandlers: ConnectionHandlers = {
			onConnectWebSocket: async (
				opts: ConnectWebSocketOpts,
			): Promise<ConnectWebSocketOutput> => {
				return await serveWebSocket(
					appConfig,
					driverConfig,
					actorDriver,
					CoordinateDriver,
					globalState,
					opts.actorId,
					opts,
				);
			},
			onConnectSse: async (opts: ConnectSseOpts): Promise<ConnectSseOutput> => {
				return await serveSse(
					appConfig,
					driverConfig,
					actorDriver,
					CoordinateDriver,
					globalState,
					opts.actorId,
					opts,
				);
			},
			onAction: async (opts: ActionOpts): Promise<ActionOutput> => {
				// TODO:
				throw new errors.InternalError("UNIMPLEMENTED");
			},
			onConnMessage: async (opts: ConnsMessageOpts): Promise<void> => {
				await publishMessageToLeader(
					appConfig,
					driverConfig,
					CoordinateDriver,
					globalState,
					opts.actorId,
					{
						b: {
							lm: {
								ai: opts.actorId,
								ci: opts.connId,
								ct: opts.connToken,
								m: opts.message,
							},
						},
					},
					opts.req.raw.signal,
				);
			},
		};

		// Build manager router
		const managerRouter = createManagerRouter(appConfig, driverConfig, {
			proxyMode: {
				inline: {
					handlers: connectionHandlers,
				},
			},
			onConnectInspector: () => {
				throw new errors.Unsupported("inspect");
			},
		});

		app.route("/", managerRouter);

		app.notFound(handleRouteNotFound);
		app.onError(handleRouteError);

		this.router = app;
	}
}
