import type { GlobalState } from "@/topologies/coordinate/topology";
import { logger } from "../log";
import { encodeDataToString, serialize } from "@/worker/protocol/serde";
import type { CoordinateDriver } from "../driver";
import { RelayConn } from "../conn/mod";
import type { WorkerDriver } from "@/worker/driver";
import { RegistryConfig } from "@/registry/config";
import { ConnectSseOpts, ConnectSseOutput } from "@/worker/router-endpoints";
import {  RunConfig } from "@/registry/run-config";

export async function serveSse(
	registryConfig: RegistryConfig,
	runConfig: RunConfig,
	workerDriver: WorkerDriver,
	CoordinateDriver: CoordinateDriver,
	globalState: GlobalState,
	workerId: string,
	{ encoding, params, authData }: ConnectSseOpts,
): Promise<ConnectSseOutput> {
	let conn: RelayConn | undefined;
	return {
		onOpen: async (stream) => {
			conn = new RelayConn(
				registryConfig,
				runConfig,
				workerDriver,
				CoordinateDriver,
				globalState,
				{
					sendMessage: (message) => {
						stream.writeSSE({
							data: encodeDataToString(serialize(message, encoding)),
						});
					},
					disconnect: async (reason) => {
						logger().debug("closing follower stream", { reason });
						stream.close();
					},
				},
				workerId,
				params,
				authData,
			);
			await conn.start();
		},
		onClose: async () => {
			conn?.disconnect(false);
		},
	};
}
