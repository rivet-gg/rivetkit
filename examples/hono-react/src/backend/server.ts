// import { registry } from "./registry";
// import { Hono } from "hono";
// import { serve } from "@hono/node-server";
// import { createMemoryDriver } from "@rivetkit/memory";
//
// // Setup router
// const app = new Hono();
//
// // Start RivetKit
// const { client, hono } = registry.run({
// 	driver: createMemoryDriver(),
// 	cors: {
// 		// IMPORTANT: Configure origins in production
// 		origin: "*",
// 	},
// });
//
// // Expose RivetKit to the frontend
// app.route("/registry", hono);
//
// // Example HTTP endpoint
// app.post("/increment/:name", async (c) => {
// 	const name = c.req.param("name");
//
// 	const counter = client.counter.getOrCreate(name);
// 	const newCount = await counter.increment(1);
//
// 	return c.text(`New Count: ${newCount}`);
// });
//
// serve({ fetch: app.fetch, port: 8080 }, () =>
// 	console.log("Listening at http://localhost:8080"),
// );
