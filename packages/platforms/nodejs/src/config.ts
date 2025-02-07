import { RedisConfig } from "@actor-core/redis";

export interface Config extends RedisConfig {
	server?: {
		hostname?: string;
		port?: number;
	};
}
