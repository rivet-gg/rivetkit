import { RedisConfig } from "@/config";
import { GlobalState } from "@/router/mod";
import Redis from "ioredis";
import { RelayConnection } from "../actor/relay_conn";
import type { WSContext } from "hono/ws";
import {
	ConnectWebSocketOpts,
	ConnectWebSocketOutput,
} from "actor-core/platform";
import { logger } from "@/log";
import { serialize } from "actor-core/actor/protocol/serde";
import * as messageToServer from "actor-core/actor/protocol/message/to_server";
import { publishMessageToLeader } from "@/node/message";
import * as errors from "actor-core/actor/errors";

export async function serveWebSocket(
	redis: Redis,
	config: RedisConfig,
	globalState: GlobalState,
	actorId: string,
	{ req, encoding, parameters }: ConnectWebSocketOpts,
): Promise<ConnectWebSocketOutput> {
	let conn: RelayConnection | undefined;
	return {
		onOpen: async (ws: WSContext) => {
			conn = new RelayConnection(
				redis,
				config,
				globalState,
				{
					sendMessage: (message) => {
						ws.send(serialize(message, encoding));
					},
					disconnect: async (reason) => {
						logger().debug("closing follower stream", { reason });
						ws.close();
					},
				},
				actorId,
				parameters,
			);
			await conn.start();
		},
		onMessage: async (message: messageToServer.ToServer) => {
			if (!conn) {
				throw new errors.InternalError("Connection not created yet");
			}

			await publishMessageToLeader(
				redis,
				config,
				globalState,
				actorId,
				{
					b: {
						lm: {
							ai: actorId,
							ci: conn.connId,
							ct: conn.connToken,
							m: message,
						},
					},
				},
				req.raw.signal,
			);
		},
		onClose: async () => {
			if (!conn) {
				throw new errors.InternalError("Connection not created yet");
			}

			conn.disconnect(false);
		},
	};
}
