import type { ConnectionDriver } from "@/actor/runtime/driver";
import type { GlobalState } from "../topology";
import type { AnyActor } from "@/actor/runtime/actor";
import type { Connection } from "@/actor/runtime/connection";
import type { CachedSerializer } from "@/actor/protocol/serde";
import type * as messageToClient from "@/actor/protocol/message/to_client";
import { logger } from "../log";
import type { NodeMessage } from "../node/protocol";
import type { CoordinateDriver } from "../driver";

export const CONN_DRIVER_COORDINATE_RELAY = "coordinateRelay";

export interface CoordinateRelayState {
	nodeId: string;
}

export function createCoordinateRelayDriver(
	globalState: GlobalState,
	CoordinateDriver: CoordinateDriver,
): ConnectionDriver<CoordinateRelayState> {
	return {
		sendMessage: (
			actor: AnyActor,
			conn: Connection<AnyActor>,
			state: CoordinateRelayState,
			message: CachedSerializer<messageToClient.ToClient>,
		) => {
			const actorPeer = globalState.actorPeers.get(actor.id);
			if (!actorPeer) {
				logger().warn("missing actor for message", { actorId: actor.id });
				return;
			}

			// Forward outoging message
			const messageRaw: NodeMessage = {
				b: {
					fm: {
						ci: conn.id,
						m: message.rawData,
					},
				},
			};
			CoordinateDriver.publishToNode(state.nodeId, JSON.stringify(messageRaw));
		},
		disconnect: async (
			actor: AnyActor,
			conn: Connection<AnyActor>,
			state: CoordinateRelayState,
			reason?: string,
		) => {
			if (actor.__isStopping) return;

			const actorPeer = globalState.actorPeers.get(actor.id);
			if (!actorPeer) {
				logger().warn("missing actor for disconnect", { actorId: actor.id });
				return;
			}

			// Forward close message
			const messageRaw: NodeMessage = {
				b: {
					fcc: {
						ci: conn.id,
						r: reason,
					},
				},
			};
			CoordinateDriver.publishToNode(state.nodeId, JSON.stringify(messageRaw));
		},
	};
}
