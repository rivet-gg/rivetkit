import type { GlobalState } from "@/topologies/coordinate/topology";
import type { WSContext } from "hono/ws";
import { logger } from "../log";
import { serialize } from "@/actor/protocol/serde";
import type * as messageToServer from "@/actor/protocol/message/to-server";
import * as errors from "@/actor/errors";
import type { CoordinateDriver } from "../driver";
import { RelayConnection } from "../conn/mod";
import { publishMessageToLeader } from "../node/message";
import type { ActorDriver } from "@/actor/driver";
import type { ConnectWebSocketOpts, ConnectWebSocketOutput } from "@/actor/router";
import { DriverConfig } from "@/driver-helpers/config";
import { AppConfig } from "@/app/config";

export async function serveWebSocket(
	appConfig: AppConfig,
	driverConfig: DriverConfig,
	actorDriver: ActorDriver,
	CoordinateDriver: CoordinateDriver,
	globalState: GlobalState,
	actorId: string,
	{ req, encoding, parameters }: ConnectWebSocketOpts,
): Promise<ConnectWebSocketOutput> {
	let conn: RelayConnection | undefined;
	return {
		onOpen: async (ws: WSContext) => {
			conn = new RelayConnection(
				appConfig,
				driverConfig,
				actorDriver,
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
				parameters,
			);
			await conn.start();
		},
		onMessage: async (message: messageToServer.ToServer) => {
			if (!conn) {
				throw new errors.InternalError("Connection not created yet");
			}

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
