import type { UniversalWebSocket } from "@rivetkit/core";
import type { ActorPeer } from "./actor-peer";
import type { RelayWebSocketAdapter } from "./node/relay-websocket-adapter";

// TODO: Define RelayConn type when conn module is implemented
type RelayConn = any;

// TODO: Clean this up to make it clear which properties are used by leaders & which are used by followers
export interface GlobalState {
	nodeId: string;
	/** Actors currently running on this instance. */
	actorPeers: Map<string, ActorPeer>;
	/** Connections that are connected to this node. */
	relayConns: Map<string, RelayConn>;
	/** Resolvers for when a message is acknowledged by the peer. */
	messageAckResolvers: Map<string, () => void>;
	/** Resolvers for when an action response is received. */
	actionResponseResolvers: Map<
		string,
		(result: { success: boolean; output?: unknown; error?: string }) => void
	>;
	/** Resolvers for when a fetch response is received. */
	fetchResponseResolvers: Map<string, (response: any) => void>;
	/** Raw WebSocket connections mapped by WebSocket ID. */
	rawWebSockets: Map<string, UniversalWebSocket>;
	followerWebSockets: Map<string, { ws: any; relayConn: RelayConn }>;

	relayWebSockets: Map<string, RelayWebSocketAdapter>;
}
