import { Redis } from "ioredis";
import { z } from "zod";
import { CoordinateDriverConfig } from "./coordinate/config";

export const RedisDriverConfig = CoordinateDriverConfig.extend({
	redis: z
		.custom<Redis>((val) => val instanceof Redis, {
			message: "Must be an instance of Redis",
		})
		.optional()
		.default(
			() =>
				new Redis({
					host: process.env.REDIS_HOST ?? "localhost",
					port: process.env.REDIS_PORT
						? parseInt(process.env.REDIS_PORT, 10)
						: 6379,
					password: process.env.REDIS_PASSWORD,
				}),
		),
	keyPrefix: z
		.string()
		.default(() => process.env.REDIS_KEY_PREFIX ?? "rivetkit"),
});

export type RedisDriverConfig = z.infer<typeof RedisDriverConfig>;

export { CoordinateDriverConfig as DriverConfig } from "./coordinate/config";
