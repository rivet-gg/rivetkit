import type { GlobalState } from "@/topologies/coordinate/topology";
import { logger } from "../log";
import { encodeDataToString, serialize } from "@/worker/protocol/serde";
import type { CoordinateDriver } from "../driver";
import { RelayConn } from "../conn/mod";
import type { WorkerDriver } from "@/worker/driver";
import { DriverConfig } from "@/driver-helpers/config";
import { RegistryConfig } from "@/registry/config";
import { ConnectSseOpts, ConnectSseOutput } from "@/worker/router-endpoints";

export async function serveSse(
	registryConfig: RegistryConfig,
	driverConfig: DriverConfig,
	workerDriver: WorkerDriver,
	CoordinateDriver: CoordinateDriver,
	globalState: GlobalState,
	workerId: string,
	{ encoding, params }: ConnectSseOpts,
): Promise<ConnectSseOutput> {
	let conn: RelayConn | undefined;
	return {
		onOpen: async (stream) => {
			conn = new RelayConn(
				registryConfig,
				driverConfig,
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
			);
			await conn.start();
		},
		onClose: async () => {
			conn?.disconnect(false);
		},
	};
}
