import { RedisConfig } from "@/config";
import { GlobalState } from "@/router/mod";
import { logger } from "@/log";
import Redis from "ioredis";
import { encodeDataToString, serialize } from "actor-core/actor/protocol/serde";
import { RelayConnection } from "../actor/relay_conn";
import type { ConnectSseOpts, ConnectSseOutput } from "actor-core/platform";

export async function serveSse(
	redis: Redis,
	config: RedisConfig,
	globalState: GlobalState,
	actorId: string,
	{ encoding, parameters }: ConnectSseOpts,
): Promise<ConnectSseOutput> {
	let conn: RelayConnection | undefined;
	return {
		onOpen: async (stream) => {
			conn = new RelayConnection(
				redis,
				config,
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
