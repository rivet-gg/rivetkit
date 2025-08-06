import { actor, CONNECTION_DRIVER_WEBSOCKET } from "@rivetkit/core";

export const connLivenessActor = actor({
	onAuth: () => {},
	state: {
		counter: 0,
		acceptingConnections: true,
	},
	options: {
		lifecycle: {
			connectionLivenessInterval: 5_000,
			connectionLivenessTimeout: 2_500,
		},
	},
	onConnect: (c, conn) => {
		if (!c.state.acceptingConnections) {
			conn.disconnect();
			throw new Error("Actor is not accepting connections");
		}
	},
	actions: {
		getWsConnectionsLiveness: (c) => {
			return Array.from(c.conns.values())
				.filter((conn) => conn.driver === CONNECTION_DRIVER_WEBSOCKET)
				.map((conn) => ({
					id: conn.id,
					status: conn.status,
					lastSeen: conn.lastSeen,
				}));
		},
		getConnectionId: (c) => {
			return c.conn.id;
		},
		kill: (c, connId: string) => {
			c.state.acceptingConnections = false;
			// Disconnect the connection with the given ID
			// This simulates a network failure or a manual disconnection
			// The connection will be cleaned up by the actor manager after the timeout
			const conn = c.conns.get(connId);
			if (conn) {
				conn.disconnect();
			}
		},
		getCounter: (c) => {
			return c.state.counter;
		},
		increment: (c, amount: number) => {
			c.state.counter += amount;
			return c.state.counter;
		},
	},
});
