import { registry } from "./registry";

registry.runServer({
	cors: {
		origin: "*",
	},
});
