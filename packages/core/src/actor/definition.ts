import type { RegistryConfig } from "@/registry/config";
import type { ActionContext } from "./action";
import type { Actions, ActorConfig } from "./config";
import type { ActorContext } from "./context";
import type { AnyDatabaseProvider } from "./database";
import { ActorInstance } from "./instance";

export type AnyActorDefinition = ActorDefinition<
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	any
>;

/**
 * Extracts the context type from an ActorDefinition
 */
export type ActorContextOf<AD extends AnyActorDefinition> =
	AD extends ActorDefinition<
		infer S,
		infer CP,
		infer CS,
		infer V,
		infer I,
		infer AD,
		infer DB,
		any
	>
		? ActorContext<S, CP, CS, V, I, AD, DB>
		: never;

/**
 * Extracts the context type from an ActorDefinition
 */
export type ActionContextOf<AD extends AnyActorDefinition> =
	AD extends ActorDefinition<
		infer S,
		infer CP,
		infer CS,
		infer V,
		infer I,
		infer AD,
		infer DB,
		any
	>
		? ActionContext<S, CP, CS, V, I, AD, DB>
		: never;

export class ActorDefinition<
	S,
	CP,
	CS,
	V,
	I,
	AD,
	DB extends AnyDatabaseProvider,
	R extends Actions<S, CP, CS, V, I, AD, DB>,
> {
	#config: ActorConfig<S, CP, CS, V, I, AD, DB>;

	constructor(config: ActorConfig<S, CP, CS, V, I, AD, DB>) {
		this.#config = config;
	}

	get config(): ActorConfig<S, CP, CS, V, I, AD, DB> {
		return this.#config;
	}

	instantiate(): ActorInstance<S, CP, CS, V, I, AD, DB> {
		return new ActorInstance(this.#config);
	}
}

export function lookupInRegistry(
	registryConfig: RegistryConfig,
	name: string,
): AnyActorDefinition {
	// Build actor
	const definition = registryConfig.use[name];
	if (!definition) throw new Error(`no actor in registry for name ${name}`);
	return definition;
}
