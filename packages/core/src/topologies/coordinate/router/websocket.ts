import type { GlobalState } from "@/topologies/coordinate/topology";
import type { WSContext } from "hono/ws";
import { logger } from "../log";
import { serialize } from "@/worker/protocol/serde";
import type * as messageToServer from "@/worker/protocol/message/to-server";
import * as errors from "@/worker/errors";
import type { CoordinateDriver } from "../driver";
import { RelayConn } from "../conn/mod";
import { publishMessageToLeader } from "../node/message";
import type { WorkerDriver } from "@/worker/driver";
import type { RegistryConfig } from "@/registry/config";
import {
	ConnectWebSocketOpts,
	ConnectWebSocketOutput,
} from "@/worker/router-endpoints";
import { DriverConfig, RunConfig } from "@/registry/run-config";

export async function serveWebSocket(
	registryConfig: RegistryConfig,
	runConfig: RunConfig,
	workerDriver: WorkerDriver,
	CoordinateDriver: CoordinateDriver,
	globalState: GlobalState,
	workerId: string,
	{ req, encoding, params, authData }: ConnectWebSocketOpts,
): Promise<ConnectWebSocketOutput> {
	let conn: RelayConn | undefined;
	return {
		onOpen: async (ws: WSContext) => {
			conn = new RelayConn(
				registryConfig,
				runConfig,
				workerDriver,
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
				workerId,
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
				workerId,
				{
					b: {
						lm: {
							ai: workerId,
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
