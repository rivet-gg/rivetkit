import { registry } from "./registry";

registry.runServer({
	cors: {
		// IMPORTANT: Configure origins in production
		origin: "*",
	},
});
