// import { registry } from "./registry";
// import { Elysia } from "elysia";
// import { createMemoryDriver } from "@rivetkit/memory";
//
// // Start RivetKit
// const { client, handler } = registry.run({
// 	driver: createMemoryDriver(),
// });
//
// // Setup router
// const app = new Elysia()
// 	// Expose RivetKit to the frontend (optional)
// 	.mount("/registry", handler)
// 	// Example HTTP endpoint
// 	.post("/increment/:name", async ({ params }) => {
// 		const name = params.name;
//
// 		const counter = client.counter.getOrCreate(name);
// 		const newCount = await counter.increment(1);
//
// 		return `New Count: ${newCount}`;
// 	})
// 	.listen(6420);
//
// console.log("Listening at http://localhost:6420");
