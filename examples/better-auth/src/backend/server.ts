import { registry } from "./registry";
import { auth } from "./auth";
import { Hono } from "hono";
import { cors } from "hono/cors";

// Start RivetKit
const { client, hono, serve } = registry.createServer();

// Setup router
const app = new Hono();

app.use(
	"*",
	cors({
		origin: ["http://localhost:5173"],
		allowHeaders: ["Content-Type", "Authorization"],
		allowMethods: ["POST", "GET", "OPTIONS"],
		exposeHeaders: ["Content-Length"],
		maxAge: 600,
		credentials: true,
	}),
);

// Mount Better Auth routes
app.on(["GET", "POST"], "/api/auth/**", (c) => auth.handler(c.req.raw));

serve(app);
