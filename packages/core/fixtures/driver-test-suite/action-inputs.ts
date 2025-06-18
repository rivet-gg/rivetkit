import { worker } from "rivetkit";

export interface State {
	initialInput?: unknown;
	onCreateInput?: unknown;
}

// Test worker that can capture input during creation
export const inputWorker = worker({
	onAuth: () => {},
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

