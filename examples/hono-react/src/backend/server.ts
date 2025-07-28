import { Hono } from "hono";
import { registry } from "./registry";

const { client, serve } = registry.createServer({
	cors: {
		origin: "http://localhost:5173",
	},
});

// Setup router
const app = new Hono();

// Example HTTP endpoint
app.post("/increment/:name", async (c) => {
	const name = c.req.param("name");

	const counter = client.counter.getOrCreate(name);
	const newCount = await counter.increment(1);

	return c.text(`New Count: ${newCount}`);
});

serve(app);
