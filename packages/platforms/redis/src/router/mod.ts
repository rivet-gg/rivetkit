import { createActorRouter, Manager } from "actor-core/platform";
import { buildManager } from "../manager";
import { RedisConfig } from "../config";
import type { PlatformConfig } from "../platform_config";
import { serveSse } from "./sse";
import { serveWebSocket } from "./websocket";
import { RelayConnection } from "../actor/relay_conn";
import { Node } from "../node/node";
import { buildRedis } from "../redis";
import { ActorPeer } from "../actor/peer";
import * as errors from "actor-core/actor/errors";
import { publishMessageToLeader } from "@/node/message";
import * as events from "node:events";

export interface GlobalState {
	nodeId: string;
	/** Actors currently running on this instance. */
	actorPeers: Map<string, ActorPeer>;
	/** Connections that are connected to this node. */
	relayConnections: Map<string, RelayConnection>;
	/** Resolvers for when a message is acknowledged by the peer. */
	messageAckResolvers: Map<string, () => void>;
}

export function createRouter(
	config: RedisConfig,
	platformConfig: PlatformConfig,
) {
	// Allow usage of a lot of AbortSignals (which are EventEmitters)
	//events.defaultMaxListeners = 100_000;
	events.setMaxListeners(100_000);

	// Create connection
	const redis = buildRedis(config);

	const globalState: GlobalState = {
		nodeId: crypto.randomUUID(),
		actorPeers: new Map(),
		relayConnections: new Map(),
		messageAckResolvers: new Map(),
	};

	const node = new Node(redis, config, globalState);
	node.start();

	const manager = new Manager(buildManager(redis));

	const app = manager.router;

	// Forward requests to actor
	const actorRouter = createActorRouter(config, {
		upgradeWebSocket: platformConfig.getUpgradeWebSocket?.(app),
		onConnectWebSocket: async (opts) => {
			const actorId = opts.req.param("actorId");
			if (!actorId) throw new errors.InternalError("Missing actor ID");
			return await serveWebSocket(redis, config, globalState, actorId, opts);
		},
		onConnectSse: async (opts) => {
			const actorId = opts.req.param("actorId");
			if (!actorId) throw new errors.InternalError("Missing actor ID");
			return await serveSse(redis, config, globalState, actorId, opts);
		},
		onRpc: async () => {
			// TODO:
			throw new errors.InternalError("UNIMPLEMENTED");
		},
		onConnectionsMessage: async ({ req, connId, connToken, message }) => {
			const actorId = req.param("actorId");
			if (!actorId) throw new errors.InternalError("Missing actor ID");

			await publishMessageToLeader(
				redis,
				config,
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
	});

	app.route("/actors/:actorId", actorRouter);

	app.all("*", (c) => {
		return c.text("Not Found (ActorCore)", 404);
	});

	return app;
}
