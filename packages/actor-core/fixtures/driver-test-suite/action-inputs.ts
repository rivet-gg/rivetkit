import { actor, setup } from "actor-core";

interface State {
	initialInput?: unknown;
	onCreateInput?: unknown;
}

// Test actor that can capture input during creation
const inputActor = actor({
	createState: (c, { input }): State => {
		return {
			initialInput: input,
			onCreateInput: undefined,
		};
	},

	onCreate: (c, { input }) => {
		c.state.onCreateInput = input;
	},

	actions: {
		getInputs: (c) => {
			return {
				initialInput: c.state.initialInput,
				onCreateInput: c.state.onCreateInput,
			};
		},
	},
});

export const app = setup({
	actors: { inputActor },
});

export type App = typeof app;
