import { registry } from "./registry";

registry.runServer({
	cors: {
		origin: "http://localhost:5173",
	},
});
