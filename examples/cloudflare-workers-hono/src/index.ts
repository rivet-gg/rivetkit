import { createServer } from "@rivetkit/cloudflare-workers";
import { Hono } from "hono";
import { registry } from "./registry";

const { client, createHandler } = createServer(registry);

// Setup router
const app = new Hono();

// Example HTTP endpoint
app.post("/increment/:name", async (c) => {
	const name = c.req.param("name");

	const counter = client.counter.getOrCreate(name);
	const newCount = await counter.increment(1);

	return c.text(`New Count: ${newCount}`);
});

const { handler, ActorHandler } = createHandler(app);

export { handler as default, ActorHandler };
