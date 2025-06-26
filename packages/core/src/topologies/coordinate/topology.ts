import * as events from "node:events";
import type { ConnRoutingHandler } from "@/actor/conn-routing-handler";
import * as errors from "@/actor/errors";
import type {
	ActionOpts,
	ActionOutput,
	ConnectSseOpts,
	ConnectSseOutput,
	ConnectWebSocketOpts,
	ConnectWebSocketOutput,
	ConnectionHandlers,
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
import { Hono } from "hono";
import invariant from "invariant";
import type { ActorPeer } from "./actor-peer";
import type { RelayConn } from "./conn/mod";
import { publishMessageToLeader } from "./node/message";
import { Node } from "./node/mod";
import { serveSse } from "./router/sse";
import { serveWebSocket } from "./router/websocket";

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
	public readonly clientDriver: ClientDriver;
	inlineClient: Client<Registry<any>>;
	public readonly router: Hono;

	constructor(registryConfig: RegistryConfig, runConfig: RunConfig) {
		const { actor: actorDriver, coordinate: CoordinateDriver } =
			runConfig.driver;
		if (!CoordinateDriver)
			throw new Error("config.driver.coordinate not defined.");

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

		// Build router
		const router = new Hono();

		// Share connection handlers for both routers
		const connectionHandlers: ConnectionHandlers = {
			onConnectWebSocket: async (
				opts: ConnectWebSocketOpts,
			): Promise<ConnectWebSocketOutput> => {
				return await serveWebSocket(
					registryConfig,
					runConfig,
					actorDriver,
					this.inlineClient,
					CoordinateDriver,
					globalState,
					opts.actorId,
					opts,
				);
			},
			onConnectSse: async (opts: ConnectSseOpts): Promise<ConnectSseOutput> => {
				return await serveSse(
					registryConfig,
					runConfig,
					actorDriver,
					this.inlineClient,
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
					registryConfig,
					runConfig,
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
					opts.req?.raw.signal,
				);
			},
		};

		const routingHandler: ConnRoutingHandler = {
			inline: { handlers: connectionHandlers },
		};

		// Create driver
		const managerDriver = runConfig.driver.manager;
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
				// onConnectInspector: () => {
				// 	throw new errors.Unsupported("inspect");
				// },
			},
		);

		router.route("/", managerRouter);

		this.router = router;
	}
}
