import { registry } from "./registry";
import { Elysia } from "elysia";

const { client, handler } = registry.createServer();

// Setup router
new Elysia()
	// Expose RivetKit to the frontend (optional)
	.mount("/registry", handler)
	// Example HTTP endpoint
	.post("/increment/:name", async ({ params }) => {
		const name = params.name;

		const counter = client.counter.getOrCreate(name);
		const newCount = await counter.increment(1);

		return `New Count: ${newCount}`;
	})
	.listen(8080);

console.log("Listening at http://localhost:8080");
