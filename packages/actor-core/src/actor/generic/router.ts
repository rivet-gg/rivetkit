import * as errors from "@/actor/errors";
import type { AnyActor } from "@/actor/runtime/actor";
import { createActorRouter } from "@/actor/runtime/actor_router";
import { BaseConfig } from "@/actor/runtime/config";
import { Handler, Context as HonoContext } from "hono";
import {
	Connection,
	generateConnectionId,
	generateConnectionToken,
} from "@/actor/runtime/connection";
import { logger } from "@/actor/runtime/log";
import { Rpc } from "@/actor/runtime/rpc";
import {
	CONN_DRIVER_HTTP,
	CONN_DRIVER_SSE,
	CONN_DRIVER_WEBSOCKET,
	GenericDriverGlobalState,
	HttpDriverState,
	SseDriverState,
	WebSocketDriverState,
} from "./conn_driver";
import { UpgradeWebSocket } from "hono/ws";

interface GenericActorRouterOpts {
	config: BaseConfig;
	driverGlobal: GenericDriverGlobalState;
	actor: AnyActor;

	// This is dynamic since NodeJS requires a reference to the app to initialize WebSockets
	//upgradeWebSocket?: (createEvents: (c: HonoContext) => any) => Handler;
	upgradeWebSocket?: UpgradeWebSocket,
}

/**
 * Exposes generic router for platforms that support vanilla WebSocket, SSE, and HTTP.
 */
export function createGenericActorRouter({
	config,
	driverGlobal,
	actor,
	upgradeWebSocket,
}: GenericActorRouterOpts) {
	// Forward requests to actor
	return createActorRouter(config, {
		upgradeWebSocket,
		onConnectWebSocket: async ({ req, encoding, parameters: connParams }) => {
			if (actor.__initializedPromise) await actor.__initializedPromise;

			const connId = generateConnectionId();
			const connToken = generateConnectionToken();
			const connState = await actor.__prepareConnection(connParams, req.raw);

			let conn: Connection<AnyActor> | undefined;
			return {
				onOpen: async (ws) => {
					// Save socket
					driverGlobal.websockets.set(connId, ws);

					// Create connection
					conn = await actor.__createConnection(
						connId,
						connToken,

						connParams,
						connState,
						CONN_DRIVER_WEBSOCKET,
						{ encoding } satisfies WebSocketDriverState,
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
					driverGlobal.websockets.delete(connId);

					if (conn) {
						actor.__removeConnection(conn);
					}
				},
			};
		},
		onConnectSse: async ({ req, encoding, parameters: connParams }) => {
			if (actor.__initializedPromise) await actor.__initializedPromise;

			const connId = generateConnectionId();
			const connToken = generateConnectionToken();
			const connState = await actor.__prepareConnection(connParams, req.raw);

			let conn: Connection<AnyActor> | undefined;
			return {
				onOpen: async (stream) => {
					// Save socket
					driverGlobal.sseStreams.set(connId, stream);

					// Create connection
					conn = await actor.__createConnection(
						connId,
						connToken,
						connParams,
						connState,
						CONN_DRIVER_SSE,
						{ encoding } satisfies SseDriverState,
					);
				},
				onClose: async () => {
					driverGlobal.sseStreams.delete(connId);

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
				if (actor.__initializedPromise) await actor.__initializedPromise;

				// Create conn
				const connState = await actor.__prepareConnection(connParams, req.raw);
				conn = await actor.__createConnection(
					generateConnectionId(),
					generateConnectionToken(),
					connParams,
					connState,
					CONN_DRIVER_HTTP,
					{} satisfies HttpDriverState,
				);

				// Call RPC
				const ctx = new Rpc<AnyActor>(conn);
				const output = await actor.__executeRpc(ctx, rpcName, rpcArgs);

				return { output };
			} finally {
				if (conn) {
					actor.__removeConnection(conn);
				}
			}
		},
		onConnectionsMessage: async ({ connId, connToken, message }) => {
			// Wait for init to finish
			if (actor.__initializedPromise) await actor.__initializedPromise;

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
}
