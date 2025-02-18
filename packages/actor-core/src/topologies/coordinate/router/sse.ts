import type { GlobalState } from "@/topologies/coordinate/topology";
import { logger } from "../log";
import { encodeDataToString, serialize } from "@/actor/protocol/serde";
import type { CoordinateDriver } from "../driver";
import { RelayConnection } from "../conn/mod";
import type { ActorDriver } from "@/actor/runtime/driver";
import type { BaseConfig } from "@/actor/runtime/config";
import type { ConnectSseOpts, ConnectSseOutput } from "@/actor/runtime/actor_router";

export async function serveSse(
	config: BaseConfig,
	actorDriver: ActorDriver,
	CoordinateDriver: CoordinateDriver,
	globalState: GlobalState,
	actorId: string,
	{ encoding, parameters }: ConnectSseOpts,
): Promise<ConnectSseOutput> {
	let conn: RelayConnection | undefined;
	return {
		onOpen: async (stream) => {
			conn = new RelayConnection(
				config,
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
				parameters,
			);
			await conn.start();
		},
		onClose: async () => {
			conn?.disconnect(false);
		},
	};
}
