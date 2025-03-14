import type { RecursivePartial } from "./utils";
import { z } from "zod";

export const StateConfigSchema = z.object({
	saveInterval: z.number().positive(),
});
export type StateConfig = z.infer<typeof StateConfigSchema>;

export const RpcConfigSchema = z.object({
	timeout: z.number().positive(),
});
export type RpcConfig = z.infer<typeof RpcConfigSchema>;

export const ActorConfigSchema = z.object({
	state: StateConfigSchema,
	rpc: RpcConfigSchema,
});
export type ActorConfig = z.infer<typeof ActorConfigSchema>;

export const DEFAULT_ACTOR_CONFIG: ActorConfig = {
	state: {
		saveInterval: 1000,
	},
	rpc: {
		timeout: 60_000,
	},
};

export function mergeActorConfig(
	partialConfig?: RecursivePartial<ActorConfig>,
): ActorConfig {
	const mergedConfig = {
		state: {
			saveInterval:
				partialConfig?.state?.saveInterval ??
				DEFAULT_ACTOR_CONFIG.state.saveInterval,
		},
		rpc: {
			timeout: partialConfig?.rpc?.timeout ?? DEFAULT_ACTOR_CONFIG.rpc.timeout,
		},
	};
	
	// Validate the merged config against the schema
	return ActorConfigSchema.parse(mergedConfig);
}
