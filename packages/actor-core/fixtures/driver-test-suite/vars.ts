import { actor, setup } from "actor-core";

// Actor with static vars
const staticVarActor = actor({
	state: { value: 0 },
	connState: { hello: "world" },
	vars: { counter: 42, name: "test-actor" },
	actions: {
		getVars: (c) => {
			return c.vars;
		},
		getName: (c) => {
			return c.vars.name;
		},
	},
});

// Actor with nested vars
const nestedVarActor = actor({
	state: { value: 0 },
	connState: { hello: "world" },
	vars: {
		counter: 42,
		nested: {
			value: "original",
			array: [1, 2, 3],
			obj: { key: "value" },
		},
	},
	actions: {
		getVars: (c) => {
			return c.vars;
		},
		modifyNested: (c) => {
			// Attempt to modify the nested object
			c.vars.nested.value = "modified";
			c.vars.nested.array.push(4);
			c.vars.nested.obj.key = "new-value";
			return c.vars;
		},
	},
});

// Actor with dynamic vars
const dynamicVarActor = actor({
	state: { value: 0 },
	connState: { hello: "world" },
	createVars: () => {
		return {
			random: Math.random(),
			computed: `Actor-${Math.floor(Math.random() * 1000)}`,
		};
	},
	actions: {
		getVars: (c) => {
			return c.vars;
		},
	},
});

// Actor with unique vars per instance
const uniqueVarActor = actor({
	state: { value: 0 },
	connState: { hello: "world" },
	createVars: () => {
		return {
			id: Math.floor(Math.random() * 1000000),
		};
	},
	actions: {
		getVars: (c) => {
			return c.vars;
		},
	},
});

// Actor that uses driver context
const driverCtxActor = actor({
	state: { value: 0 },
	connState: { hello: "world" },
	createVars: (c, driverCtx: any) => {
		return {
			hasDriverCtx: Boolean(driverCtx?.isTest),
		};
	},
	actions: {
		getVars: (c) => {
			return c.vars;
		},
	},
});

export const app = setup({
	actors: {
		staticVarActor,
		nestedVarActor,
		dynamicVarActor,
		uniqueVarActor,
		driverCtxActor,
	},
});

export type App = typeof app;

