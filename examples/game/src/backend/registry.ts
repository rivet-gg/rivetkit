import { actor, setup } from "@rivetkit/actor";

export type Position = { x: number; y: number };
export type Input = { x: number; y: number };
export type Player = { id: string; position: Position; input: Input };

const gameRoom = actor({
	onAuth: () => {},
	// Persistent state that survives restarts: https://rivet.gg/docs/actors/state
	state: {
		players: {} as Record<string, Player>,
		mapSize: 800,
	},

	onStart: (c) => {
		// Set up game update loop
		setInterval(() => {
			const playerList: Player[] = [];
			let hasPlayers = false;

			for (const id in c.state.players) {
				const player = c.state.players[id];
				const speed = 5;

				// Update position based on input
				player.position.x += player.input.x * speed;
				player.position.y += player.input.y * speed;

				// Keep player in bounds
				player.position.x = Math.max(
					10,
					Math.min(player.position.x, c.state.mapSize - 10),
				);
				player.position.y = Math.max(
					10,
					Math.min(player.position.y, c.state.mapSize - 10),
				);

				// Add to list for broadcast
				playerList.push(player);
				hasPlayers = true;
			}

			// Only broadcast if there are players
			if (hasPlayers) {
				// Send events to all connected clients: https://rivet.gg/docs/actors/events
				c.broadcast("worldUpdate", { playerList });
			}
		}, 50);

		// Store interval ID for cleanup (would need to be cleaned up manually if needed)
		// For now, we'll let the interval run since there's no cleanup method
	},

	// Handle client connections: https://rivet.gg/docs/actors/connection-lifecycle
	onConnect: (c, conn) => {
		const id = conn.id;
		// State changes are automatically persisted
		c.state.players[id] = {
			id,
			position: {
				x: Math.floor(Math.random() * (c.state.mapSize - 100)) + 50,
				y: Math.floor(Math.random() * (c.state.mapSize - 100)) + 50,
			},
			input: { x: 0, y: 0 },
		};

		// Send initial world state to new player
		const playerList = Object.values(c.state.players);
		conn.send("worldUpdate", { playerList });
	},

	onDisconnect: (c, conn) => {
		delete c.state.players[conn.id];
	},

	actions: {
		// Callable functions from clients: https://rivet.gg/docs/actors/actions
		setInput: (c, input: Input) => {
			const player = c.state.players[c.conn.id];
			if (player) {
				player.input = input;
			}
		},

		getPlayerCount: (c) => {
			return Object.keys(c.state.players).length;
		},
	},
});

// Register actors for use: https://rivet.gg/docs/setup
export const registry = setup({
	use: { gameRoom },
});
