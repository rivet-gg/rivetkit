import type { GlobalState } from "@/topologies/coordinate/topology";
import { logger } from "../log";
import { encodeDataToString, serialize } from  "@/actor/protocol/serde";
import type { CoordinateDriver } from "../driver";
import { RelayConn } from "../conn/mod";
import type { ActorDriver } from  "@/actor/driver";
import { RegistryConfig } from "@/registry/config";
import { ConnectSseOpts, ConnectSseOutput } from  "@/actor/router-endpoints";
import {  RunConfig } from "@/registry/run-config";

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
