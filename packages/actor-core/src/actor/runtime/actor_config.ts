import type { RecursivePartial } from "./utils";

export interface ActorConfig {
	connections: {
		maxConnectionParametersSize: number;
		maxIncomingMessageSize: number;
	};
	state: StateConfig;
	rpc: RpcConfig;
}

export interface StateConfig {
	saveInterval: number;
}

export interface RpcConfig {
	timeout: number;
}

export const DEFAULT_ACTOR_CONFIG: ActorConfig = {
	connections: {
		// This goes in the URL so the default needs to be short
		maxConnectionParametersSize: 8_192,
		maxIncomingMessageSize: 65_536,
	},
	state: {
		saveInterval: 1000,
	},
	rpc: {
		timeout: 5000,
	},
};

export function mergeActorConfig(
	partialConfig?: RecursivePartial<ActorConfig>,
): ActorConfig {
	return {
		connections: {
			maxConnectionParametersSize:
				partialConfig?.connections?.maxConnectionParametersSize ??
				DEFAULT_ACTOR_CONFIG.connections.maxConnectionParametersSize,
			maxIncomingMessageSize:
				partialConfig?.connections?.maxIncomingMessageSize ??
				DEFAULT_ACTOR_CONFIG.connections.maxIncomingMessageSize,
		},
		state: {
			saveInterval:
				partialConfig?.state?.saveInterval ??
				DEFAULT_ACTOR_CONFIG.state.saveInterval,
		},
		rpc: {
			timeout: partialConfig?.rpc?.timeout ?? DEFAULT_ACTOR_CONFIG.rpc.timeout,
		},
	};
}
