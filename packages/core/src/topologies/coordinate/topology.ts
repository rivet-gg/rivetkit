import { Node } from "./node/mod";
import type { WorkerPeer } from "./worker-peer";
import * as errors from "@/worker/errors";
import * as events from "node:events";
import { publishMessageToLeader } from "./node/message";
import type { RelayConn } from "./conn/mod";
import { Hono } from "hono";
import { handleRouteError, handleRouteNotFound } from "@/common/router";
import type { RegistryConfig } from "@/registry/config";
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
} from "@/worker/router-endpoints";
import invariant from "invariant";
import { createInlineClientDriver } from "@/inline-client-driver/mod";
import { serveWebSocket } from "./router/websocket";
import { serveSse } from "./router/sse";
import { ClientDriver } from "@/client/client";
import { ConnRoutingHandler } from "@/worker/conn-routing-handler";
import { DriverConfig, RunConfig } from "@/registry/run-config";

export interface GlobalState {
	nodeId: string;
	/** Workers currently running on this instance. */
	workerPeers: Map<string, WorkerPeer>;
	/** Connections that are connected to this node. */
	relayConns: Map<string, RelayConn>;
	/** Resolvers for when a message is acknowledged by the peer. */
	messageAckResolvers: Map<string, () => void>;
}

export class CoordinateTopology {
	public readonly clientDriver: ClientDriver;
	public readonly router: Hono;

	constructor(registryConfig: RegistryConfig, runConfig: RunConfig) {
		const { worker: workerDriver, coordinate: CoordinateDriver } =
			runConfig.driver;
		if (!CoordinateDriver)
			throw new Error("config.driver.coordinate not defined.");

		// Allow usage of a lot of AbortSignals (which are EventEmitters)
		//events.defaultMaxListeners = 100_000;
		events.setMaxListeners(100_000);

		const globalState: GlobalState = {
			nodeId: crypto.randomUUID(),
			workerPeers: new Map(),
			relayConns: new Map(),
			messageAckResolvers: new Map(),
		};

		const node = new Node(CoordinateDriver, globalState);
		node.start();

		// Build router
		const router = new Hono();

		const upgradeWebSocket = runConfig.getUpgradeWebSocket?.(router);

		// Share connection handlers for both routers
		const connectionHandlers: ConnectionHandlers = {
			onConnectWebSocket: async (
				opts: ConnectWebSocketOpts,
			): Promise<ConnectWebSocketOutput> => {
				return await serveWebSocket(
					registryConfig,
					runConfig,
					workerDriver,
					CoordinateDriver,
					globalState,
					opts.workerId,
					opts,
				);
			},
			onConnectSse: async (opts: ConnectSseOpts): Promise<ConnectSseOutput> => {
				return await serveSse(
					registryConfig,
					runConfig,
					workerDriver,
					CoordinateDriver,
					globalState,
					opts.workerId,
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
					opts.workerId,
					{
						b: {
							lm: {
								ai: opts.workerId,
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
