import { actor } from "actor-core";

const counter = actor({
	onInitialize: () => {
		return { count: 0 };
	},
	rpcs: {
		increment: (c, x: number) => {
			c.state.count += x;
			c.broadcast("newCount", c.state.count);
			return c.state.count;
		},
	},
});

export default counter;
