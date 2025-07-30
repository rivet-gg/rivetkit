import { registry } from "./registry";

registry.runServer({
	cors: {
		origin: "http://localhost:3000",
	},
});
