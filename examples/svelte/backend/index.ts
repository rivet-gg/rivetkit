import { registry } from "./registry";

export type Registry = typeof registry;

registry.runServer({
	cors: {
		origin: "http://localhost:5173",
	},
});
