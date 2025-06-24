// import { registry } from "./registry";
// import { auth } from "./auth";
// import { Hono } from "hono";
// import { serve } from "@hono/node-server";
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
// // Mount Better Auth routes
// app.on(["GET", "POST"], "/api/auth/**", (c) => auth.handler(c.req.raw));
//
// // Expose RivetKit to the frontend
// app.route("/registry", hono);
//
// // Example HTTP endpoint to join chat room
// app.post("/api/join-room/:roomId", async (c) => {
// 	const roomId = c.req.param("roomId");
//
// 	// Verify authentication
// 	const authResult = await auth.api.getSession({
// 		headers: c.req.header(),
// 	});
//
// 	if (!authResult?.session || !authResult?.user) {
// 		return c.json({ error: "Unauthorized" }, 401);
// 	}
//
// 	try {
// 		const room = client.chatRoom.getOrCreate(roomId);
// 		const messages = await room.getMessages();
//
// 		return c.json({ 
// 			success: true, 
// 			roomId,
// 			messages,
// 			user: authResult.user 
// 		});
// 	} catch (error) {
// 		return c.json({ error: "Failed to join room" }, 500);
// 	}
// });
//
// serve({ fetch: app.fetch, port: 6420 }, () =>
// 	console.log("Listening at http://localhost:6420"),
// );
