import { toNextHandler } from "@rivetkit/next-js";
import { registry } from "@/rivet/registry";

const server = registry.createServer({
	// This is important for Next.js to route the API calls correctly
	// It should match the path in your Next.js API route
	// For example, if your API route is at /api/registry/[...all], this should be "/api/registry"
	basePath: "/api/registry",
	studio: {
		// Tell RivetKit Studio where to find RivetKit Registry
		defaultEndpoint: "http://localhost:3000/api/registry",
	},
});

export const { GET, POST, HEAD, PATCH, OPTIONS } = toNextHandler(server);
