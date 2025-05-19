import type { AnyActorDefinition, ActorDefinition } from "@/actor/definition";

/**
 * RPC function returned by Actor connections and handles.
 *
 * @typedef {Function} ActorRPCFunction
 * @template Args
 * @template Response
 * @param {...Args} args - Arguments for the RPC function.
 * @returns {Promise<Response>}
 */
export type ActorRPCFunction<
	Args extends Array<unknown> = unknown[],
	Response = unknown,
> = (
	...args: Args extends [unknown, ...infer Rest] ? Rest : Args
) => Promise<Response>;

/**
 * Maps RPC methods from actor definition to typed function signatures.
 */
export type ActorDefinitionRpcs<AD extends AnyActorDefinition> =
	AD extends ActorDefinition<any, any, any, any, infer R> ? {
		[K in keyof R]: R[K] extends (
			...args: infer Args
		) => infer Return
			? ActorRPCFunction<Args, Return>
			: never;
	} : never;