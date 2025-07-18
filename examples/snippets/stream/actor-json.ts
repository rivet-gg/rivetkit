import { actor } from "@rivetkit/actor";

export type StreamState = {
	topValues: number[];
};

// Simple top-K stream processor example
const streamProcessor = actor({
	state: {
		topValues: [] as number[],
	},

	actions: {
		getTopValues: (c) => c.state.topValues,

		// Add value and keep top 3
		addValue: (c, value: number) => {
			// Insert new value if needed
			const insertAt = c.state.topValues.findIndex((v) => value > v);
			if (insertAt === -1) {
				c.state.topValues.push(value);
			} else {
				c.state.topValues.splice(insertAt, 0, value);
			}

			// Keep only top 3
			if (c.state.topValues.length > 3) {
				c.state.topValues.length = 3;
			}

			// Broadcast update to all clients
			c.broadcast("updated", { topValues: c.state.topValues });

			return c.state.topValues;
		},
	},
});

export default streamProcessor;
