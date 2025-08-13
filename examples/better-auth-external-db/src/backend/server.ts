import { ALLOWED_PUBLIC_HEADERS } from "@rivetkit/actor";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./auth";
import { registry } from "./registry";

// Start RivetKit
const { serve } = registry.createServer();

// Setup router
const app = new Hono();

app.use(
	"*",
	cors({
		origin: "http://localhost:5173",
		// Need to allow custom headers used in RivetKit
		allowHeaders: ["Authorization", ...ALLOWED_PUBLIC_HEADERS],
		allowMethods: ["POST", "GET", "OPTIONS"],
		exposeHeaders: ["Content-Length"],
		maxAge: 600,
		credentials: true,
	}),
);

// Mount Better Auth routes
app.on(["GET", "POST"], "/api/auth/**", (c) => auth.handler(c.req.raw));

serve(app);
