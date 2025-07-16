import { Hono } from "hono";
import { cors } from "hono/cors";
import { registry } from "./registry";

// Start RivetKit
const { client, serve } = registry.createServer({
	cors: {
		// IMPORTANT: Configure origins in production
		origin: "*",
		// allowHeaders: ["*"],
		// allowMethods: ["*"],
		// exposeHeaders: ["*"],
		credentials: true,
		maxAge: 86400,
	},
});

// Setup router
const app = new Hono();

app.use(
	cors({
		// IMPORTANT: Configure origins in production
		origin: "*",
		// allowHeaders: ["*"],
		// allowMethods: ["*"],
		// exposeHeaders: ["*"],
		credentials: true,
		maxAge: 86400,
	}),
);

app.get("/", (c) => {
	return c.json({ message: "Fetch Handler Example Server" });
});

// Forward requests to actor's fetch handler
app.all("/forward/:name/*", async (c) => {
	const name = c.req.param("name");

	// Create new URL with the path truncated
	const truncatedPath = c.req.path.replace(`/forward/${name}`, "");
	const url = new URL(truncatedPath, c.req.url);
	const newRequest = new Request(url, c.req.raw);

	// Forward to actor's fetch handler
	const actor = client.counter.getOrCreate(name);
	const response = await actor.fetch(truncatedPath, newRequest);

	return response;
});

serve(app);

export { client };
