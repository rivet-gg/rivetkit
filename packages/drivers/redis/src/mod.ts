import {
	type DriverConfig as CoreDriverConfig,
	createActorRouter,
	createClientWithDriver,
	createInlineClientDriver,
} from "@rivetkit/core";
import type { Redis } from "ioredis";
import { RedisActorDriver } from "./actor";
import { RedisDriverConfig } from "./config";

export {
	RedisDriverConfig,
	type RedisDriverConfig as RedisDriverConfigType,
} from "./config";

import { RedisCoordinateDriver } from "./coordinate";
import { Node } from "./coordinate/node/mod";
import type { GlobalState } from "./coordinate/types";
import { RedisManagerDriver } from "./manager";

export { RedisActorDriver } from "./actor";
export { RedisManagerDriver } from "./manager";

export function createRedisDriver(
	options?: Partial<RedisDriverConfig>,
): CoreDriverConfig {
	// Create driver config - the schema will handle defaults
	const driverConfig = RedisDriverConfig.parse({
		...options,
		actorPeer: {
			...options?.actorPeer,
			leaseDuration: options?.actorPeer?.leaseDuration ?? 3000,
			renewLeaseGrace: options?.actorPeer?.renewLeaseGrace ?? 1500,
			checkLeaseInterval: options?.actorPeer?.checkLeaseInterval ?? 1000,
			checkLeaseJitter: options?.actorPeer?.checkLeaseJitter ?? 500,
			messageAckTimeout: options?.actorPeer?.messageAckTimeout ?? 1000,
		},
	});

	const globalState: GlobalState = {
		nodeId: crypto.randomUUID(),
		actorPeers: new Map(),
		relayConns: new Map(),
		messageAckResolvers: new Map(),
		actionResponseResolvers: new Map(),
		fetchResponseResolvers: new Map(),
		rawWebSockets: new Map(),
		followerWebSockets: new Map(),
		relayWebSockets: new Map(),
	};

	// TODO: Move this in to global state
	const coordinate = new RedisCoordinateDriver(
		driverConfig,
		driverConfig.redis,
	);

	// TODO: Do not create duplicate nodes
	return {
		manager: (registryConfig, runConfig) => {
			const manager = new RedisManagerDriver(
				registryConfig,
				driverConfig,
				driverConfig.redis,
			);

			// Dummy actor router that we route requests to
			const inlineClient = createClientWithDriver(
				createInlineClientDriver(manager),
			);
			const actorDriver = new RedisActorDriver(
				globalState,
				driverConfig.redis,
				driverConfig,
			);
			const actorRouter = createActorRouter(runConfig, actorDriver);

			const node = new Node(
				registryConfig,
				runConfig,
				driverConfig,
				manager,
				coordinate,
				globalState,
				inlineClient,
				actorDriver,
				actorRouter,
			);
			manager.node = node;

			// TODO: This will cause a race condition since this is async
			node.start();

			return manager;
		},
		actor: (registryConfig, runConfig, managerDriver, inlineClient) => {
			return new RedisActorDriver(
				globalState,
				driverConfig.redis,
				driverConfig,
			);
		},
	};
}
