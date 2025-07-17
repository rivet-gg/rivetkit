import type { AnyConn } from "@/actor/connection";
import type { ConnDriver } from "@/actor/driver";
import type { AnyActorInstance } from "@/actor/instance";
import type * as messageToClient from "@/actor/protocol/message/to-client";
import type { CachedSerializer } from "@/actor/protocol/serde";
import type { CoordinateDriver } from "../driver";
import { logger } from "../log";
import type { NodeMessage } from "../node/protocol";
import type { GlobalState } from "../topology";

export const CONN_DRIVER_COORDINATE_RELAY = "coordinateRelay";

export interface CoordinateRelayState {
	nodeId: string;
}

export function createCoordinateRelayDriver(
	globalState: GlobalState,
	CoordinateDriver: CoordinateDriver,
): ConnDriver<CoordinateRelayState> {
	return {
		sendMessage: (
			actor: AnyActorInstance,
			conn: AnyConn,
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
			actor: AnyActorInstance,
			conn: AnyConn,
			state: CoordinateRelayState,
			reason?: string,
		) => {
			if (actor.isStopping) return;

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
