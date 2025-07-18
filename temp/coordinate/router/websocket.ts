import type { WSContext } from "hono/ws";
import type { ActorDriver } from "@/actor/driver";
import * as errors from "@/actor/errors";
import type * as messageToServer from "@/actor/protocol/message/to-server";
import { serialize } from "@/actor/protocol/serde";
import type {
	ConnectWebSocketOpts,
	ConnectWebSocketOutput,
} from "@/actor/router-endpoints";
import type { Client } from "@/client/client";
import type { RegistryConfig } from "@/registry/config";
import type { Registry } from "@/registry/mod";
import type { RunConfig } from "@/registry/run-config";
import type { GlobalState } from "@/topologies/coordinate/topology";
import { RelayConn } from "../conn/mod";
import type { CoordinateDriver } from "../driver";
import { logger } from "../log";
import { publishMessageToLeader } from "../node/message";

export async function serveWebSocket(
	registryConfig: RegistryConfig,
	runConfig: RunConfig,
	actorDriver: ActorDriver,
	inlineClient: Client<Registry<any>>,
	CoordinateDriver: CoordinateDriver,
	globalState: GlobalState,
	actorId: string,
	{ req, encoding, params, authData }: ConnectWebSocketOpts,
): Promise<ConnectWebSocketOutput> {
	let conn: RelayConn | undefined;
	return {
		onOpen: async (ws: WSContext) => {
			conn = new RelayConn(
				registryConfig,
				runConfig,
				actorDriver,
				inlineClient,
				CoordinateDriver,
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
				params,
				authData,
			);
			await conn.start();
		},
		onMessage: async (message: messageToServer.ToServer) => {
			if (!conn) {
				throw new errors.InternalError("Connection not created yet");
			}

			await publishMessageToLeader(
				registryConfig,
				runConfig,
				CoordinateDriver,
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
				req?.raw.signal,
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
