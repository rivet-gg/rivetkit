import {
	RedisActorDriver,
	RedisCoordinateDriver,
	RedisManagerDriver,
} from "@rivetkit/redis";
import { Hono } from "hono";
import Redis from "ioredis";
import { registry } from "./registry";

// Configure Redis connection
const redisClient = new Redis({
	host: process.env.REDIS_HOST || "localhost",
	port: Number.parseInt(process.env.REDIS_PORT || "6379"),
	password: process.env.REDIS_PASSWORD,
	db: Number.parseInt(process.env.REDIS_DB || "0"),
});

// Handle Redis connection events
redisClient.on("connect", () => {
	console.log("Connected to Redis");
});

redisClient.on("error", (err) => {
	console.error("Redis connection error:", err);
});

// Start RivetKit with Redis drivers
const { client, serve } = registry.createServer({
	driver: {
		topology: "coordinate",
		actor: new RedisActorDriver(redisClient),
		manager: new RedisManagerDriver(redisClient, registry),
		coordinate: new RedisCoordinateDriver(redisClient),
	},
});

// Setup Hono router
const app = new Hono();

// Counter endpoints
app.post("/counter/:name/increment", async (c) => {
	const name = c.req.param("name");
	const body = await c.req.json().catch(() => ({ amount: 1 }));
	const amount = body.amount || 1;

	const counter = client.counter.getOrCreate(name);
	const newCount = await counter.increment(amount);

	return c.json({
		success: true,
		counter: name,
		count: newCount,
		message: `Counter '${name}' incremented by ${amount}`,
	});
});

app.get("/counter/:name", async (c) => {
	const name = c.req.param("name");

	const counter = client.counter.getOrCreate(name);
	const count = await counter.getCount();

	return c.json({
		success: true,
		counter: name,
		count,
	});
});

app.post("/counter/:name/reset", async (c) => {
	const name = c.req.param("name");

	const counter = client.counter.getOrCreate(name);
	const count = await counter.reset();

	return c.json({
		success: true,
		counter: name,
		count,
		message: `Counter '${name}' reset`,
	});
});

// Chat room endpoints
app.post("/chat/:room/message", async (c) => {
	const room = c.req.param("room");
	const body = await c.req.json();

	if (!body.user || !body.text) {
		return c.json({ error: "Missing user or text" }, 400);
	}

	const chatRoom = client.chatRoom.getOrCreate(room);
	const message = await chatRoom.sendMessage({
		user: body.user,
		text: body.text,
	});

	return c.json({
		success: true,
		room,
		message,
	});
});

app.get("/chat/:room/messages", async (c) => {
	const room = c.req.param("room");

	const chatRoom = client.chatRoom.getOrCreate(room);
	const messages = await chatRoom.getMessages();

	return c.json({
		success: true,
		room,
		messages,
	});
});

app.get("/chat/:room/users", async (c) => {
	const room = c.req.param("room");

	const chatRoom = client.chatRoom.getOrCreate(room);
	const userCount = await chatRoom.getUserCount();

	return c.json({
		success: true,
		room,
		userCount,
	});
});

// Health check
app.get("/health", async (c) => {
	try {
		await redisClient.ping();
		return c.json({
			status: "healthy",
			redis: "connected",
			timestamp: new Date().toISOString(),
		});
	} catch (error) {
		return c.json(
			{
				status: "unhealthy",
				redis: "disconnected",
				error: error instanceof Error ? error.message : "Unknown error",
				timestamp: new Date().toISOString(),
			},
			500,
		);
	}
});

// API documentation
app.get("/", (c) => {
	return c.json({
		message: "RivetKit Redis + Hono Example API",
		endpoints: {
			counter: {
				"POST /counter/:name/increment":
					"Increment counter (body: {amount?: number})",
				"GET /counter/:name": "Get counter value",
				"POST /counter/:name/reset": "Reset counter to 0",
			},
			chat: {
				"POST /chat/:room/message":
					"Send message (body: {user: string, text: string})",
				"GET /chat/:room/messages": "Get room messages",
				"GET /chat/:room/users": "Get user count",
			},
			system: {
				"GET /health": "Health check",
				"GET /": "This documentation",
			},
		},
		examples: {
			"Increment counter":
				"curl -X POST http://localhost:8088/counter/test/increment -H 'Content-Type: application/json' -d '{\"amount\": 5}'",
			"Send message":
				'curl -X POST http://localhost:8088/chat/general/message -H \'Content-Type: application/json\' -d \'{"user": "Alice", "text": "Hello world!"}\'',
		},
	});
});

serve(app);

console.log(
	"RivetKit + Hono server with Redis backend started on http://localhost:8088",
);
console.log("Try: curl http://localhost:8088");
