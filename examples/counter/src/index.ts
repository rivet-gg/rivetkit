import { setup } from "actor-core";
import counter from "./counter";

const app = setup({
	actors: { counter },
});

export type App = typeof app;
