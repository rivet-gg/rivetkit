import { worker } from "@rivetkit/core";

// Worker with static vars
export const staticVarWorker = worker({
	onAuth: () => {},
	state: { value: 0 },
	connState: { hello: "world" },
	vars: { counter: 42, name: "test-worker" },
	actions: {
		getVars: (c) => {
			return c.vars;
		},
		getName: (c) => {
			return c.vars.name;
		},
	},
});

// Worker with nested vars
export const nestedVarWorker = worker({
	onAuth: () => {},
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

// Worker with dynamic vars
export const dynamicVarWorker = worker({
	onAuth: () => {},
	state: { value: 0 },
	connState: { hello: "world" },
	createVars: () => {
		return {
			random: Math.random(),
			computed: `Worker-${Math.floor(Math.random() * 1000)}`,
		};
	},
	actions: {
		getVars: (c) => {
			return c.vars;
		},
	},
});

// Worker with unique vars per instance
export const uniqueVarWorker = worker({
	onAuth: () => {},
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

// Worker that uses driver context
export const driverCtxWorker = worker({
	onAuth: () => {},
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


