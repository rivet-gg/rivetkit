import { actor } from "@rivetkit/actor";
import { drizzle } from "@rivetkit/drizzle";
import { gameSettings, players } from "./schema";

export type Position = { x: number; y: number };
export type Input = { x: number; y: number };
export type Player = { id: string; position: Position; input: Input };

const gameRoom = actor({
	sql: drizzle(),

	// Store game settings and player inputs in memory for performance
	createVars: () => ({
		playerCache: {} as Record<string, Player>,
		mapSize: 800,
	}),

	onStart: async (c) => {
		// Get or initialize game settings
		const settings = await c.db.select().from(gameSettings).get();

		if (settings) {
			c.vars.mapSize = settings.mapSize;
		} else {
			await c.db.insert(gameSettings).values({
				mapSize: c.vars.mapSize,
			});
		}

		// Load existing players into memory
		const existingPlayers = await c.db.select().from(players);

		for (const player of existingPlayers) {
			c.vars.playerCache[player.id] = {
				id: player.id,
				position: {
					x: player.positionX,
					y: player.positionY,
				},
				input: {
					x: player.inputX,
					y: player.inputY,
				},
			};
		}

		// Set up game update loop
		setInterval(async () => {
			const worldUpdate = { playerList: [] };
			let changed = false;

			for (const id in c.vars.playerCache) {
				const player = c.vars.playerCache[id];
				const speed = 5;

				// Update position based on input
				player.position.x += player.input.x * speed;
				player.position.y += player.input.y * speed;

				// Keep player in bounds
				player.position.x = Math.max(
					0,
					Math.min(player.position.x, c.vars.mapSize),
				);
				player.position.y = Math.max(
					0,
					Math.min(player.position.y, c.vars.mapSize),
				);

				// Add to list for broadcast
				worldUpdate.playerList.push(player);
				changed = true;
			}

			// Save player positions to database if changed
			if (changed) {
				for (const id in c.vars.playerCache) {
					const player = c.vars.playerCache[id];

					await c.db
						.update(players)
						.set({
							positionX: player.position.x,
							positionY: player.position.y,
						})
						.where(players.id.equals(id));
				}

				// Broadcast world state
				c.broadcast("worldUpdate", worldUpdate);
			}
		}, 50);
	},

	// Add player to game
	onConnect: async (c) => {
		const id = c.conn.id;
		const randomX = Math.floor(Math.random() * c.vars.mapSize);
		const randomY = Math.floor(Math.random() * c.vars.mapSize);

		// Create player in memory cache
		c.vars.playerCache[id] = {
			id,
			position: {
				x: randomX,
				y: randomY,
			},
			input: { x: 0, y: 0 },
		};

		// Save player to database
		await c.db
			.insert(players)
			.values({
				id,
				positionX: randomX,
				positionY: randomY,
				inputX: 0,
				inputY: 0,
			})
			.onConflictDoUpdate({
				target: players.id,
				set: {
					positionX: randomX,
					positionY: randomY,
					inputX: 0,
					inputY: 0,
				},
			});
	},

	// Remove player from game
	onDisconnect: async (c) => {
		const id = c.conn.id;

		// Remove from memory cache
		delete c.vars.playerCache[id];

		// Remove from database
		await c.db.delete(players).where(players.id.equals(id));
	},

	actions: {
		// Update movement
		setInput: async (c, input: Input) => {
			const id = c.conn.id;
			const player = c.vars.playerCache[id];

			if (player) {
				// Update in memory for fast response
				player.input = input;

				// Update in database
				await c.db
					.update(players)
					.set({
						inputX: input.x,
						inputY: input.y,
					})
					.where(players.id.equals(id));
			}
		},
	},
});

export default gameRoom;
