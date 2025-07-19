import type { DriverConfig } from "@rivetkit/core";
import { Redis } from "ioredis";
import { RedisActorDriver } from "./actor";
import { RedisGlobalState } from "./global-state";
import { RedisManagerDriver } from "./manager";

export { RedisActorDriver } from "./actor";
export { RedisGlobalState } from "./global-state";
export { RedisManagerDriver } from "./manager";

export interface RedisDriverOptions {
	host?: string;
	port?: number;
	password?: string;
	keyPrefix?: string;
}

export function createRedisDriver(options?: RedisDriverOptions): DriverConfig {
	const redis = new Redis({
		host: options?.host ?? "localhost",
		port: options?.port ?? 6379,
		password: options?.password,
	});

	const state = new RedisGlobalState(redis, options?.keyPrefix ?? "rivetkit:");
	return {
		manager: (registryConfig, runConfig) =>
			new RedisManagerDriver(registryConfig, runConfig, state),
		actor: (registryConfig, runConfig, managerDriver, inlineClient) =>
			new RedisActorDriver(
				registryConfig,
				runConfig,
				managerDriver,
				inlineClient,
				state,
			),
	};
}
