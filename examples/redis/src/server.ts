import {
	RedisActorDriver,
	RedisCoordinateDriver,
	RedisManagerDriver,
} from "@rivetkit/redis";
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

// Start server with Redis drivers using coordinate topology
registry.runServer({
	driver: {
		topology: "coordinate",
		actor: new RedisActorDriver(redisClient),
		manager: new RedisManagerDriver(redisClient, registry),
		coordinate: new RedisCoordinateDriver(redisClient),
	},
});

console.log(
	"RivetKit server with Redis backend started on http://localhost:8088",
);
