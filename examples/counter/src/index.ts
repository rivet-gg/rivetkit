import { setup } from "actor-core";
import counter from "./counter";

export const app = setup({
	actors: { counter },
});

export type App = typeof app;
