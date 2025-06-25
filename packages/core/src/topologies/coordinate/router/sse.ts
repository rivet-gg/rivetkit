import type { ActorDriver } from "@/actor/driver";
import { encodeDataToString, serialize } from "@/actor/protocol/serde";
import type {
	ConnectSseOpts,
	ConnectSseOutput,
} from "@/actor/router-endpoints";
import type { RegistryConfig } from "@/registry/config";
import type { RunConfig } from "@/registry/run-config";
import type { GlobalState } from "@/topologies/coordinate/topology";
import { RelayConn } from "../conn/mod";
import type { CoordinateDriver } from "../driver";
import { logger } from "../log";

export async function serveSse(
	registryConfig: RegistryConfig,
	runConfig: RunConfig,
	actorDriver: ActorDriver,
	CoordinateDriver: CoordinateDriver,
	globalState: GlobalState,
	actorId: string,
	{ encoding, params, authData }: ConnectSseOpts,
): Promise<ConnectSseOutput> {
	let conn: RelayConn | undefined;
	return {
		onOpen: async (stream) => {
			conn = new RelayConn(
				registryConfig,
				runConfig,
				actorDriver,
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
				actorId,
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
