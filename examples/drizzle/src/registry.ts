// import { worker, setup } from "rivetkit";
// import { db } from "@rivetkit/db/drizzle";
// import * as schema from "./db/schema";
// import migrations from "../drizzle/migrations";

// export const counter = worker({
// 	db: db({ schema, migrations }),
// 	state: {
// 		count: 0,
// 	},
// 	onAuth: () => {
// 		// Configure auth here
// 	},
// 	actions: {
// 		increment: (c, x: number) => {
// 			// createState or state fix fix fix
// 			c.db.c.state.count += x;
// 			return c.state.count;
// 		},
// 	},
// });

// export const registry = setup({
// 	workers: { counter },
// });

// export type Registry = typeof registry;
