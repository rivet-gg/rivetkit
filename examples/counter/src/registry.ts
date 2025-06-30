import { actor, setup } from "@rivetkit/actor";

const counter = actor({
	state: {
		count: 0,
		boolean: false,
		string: "",
		number: 0,
		array: [{ id: 1, value: "value", object: { key: "value" } }],
		object: { key: "value" },
		nestedObject: { nestedKey: "nestedValue" },
		nestedArray: [{ id: 1, value: "value", object: { key: "value" } }],
		nestedObjectArray: [{ id: 1, value: "value", object: { key: "value" } }],
		nestedArrayObject: [{ id: 1, value: "value", object: { key: "value" } }],
		nestedArrays: [
			[
				{
					id: 1,
					value: "value",
					object: { key: "value" },
					array: [{ key: "value", array: [{ key: "value" }] }],
				},
			],
			[
				{
					id: 2,
					value: "value2",
					object: { key: "value2" },
					array: [{ key: "value", array: [{ key: "value" }] }],
				},
			],
		],
		undefined: undefined,
		date: new Date(),
		dateArray: [new Date(), new Date()],
		dateObject: { date: new Date() },
		null: null,
	},
	onAuth: () => {
		return true;
	},
	onStart: (c) => {
		c.schedule.after(1000, "increment", 1);
	},
	actions: {
		increment: (c, x: number) => {
			c.state.count += x;
			c.broadcast("newCount", c.state.count);
			c.schedule.after(1000, "increment", 1);
			return c.state.count;
		},
		getCount: (c) => {
			return c.state.count;
		},
	},
});

export const registry = setup({
	use: { counter },
});

export type Registry = typeof registry;
