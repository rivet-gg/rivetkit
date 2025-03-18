import {
	type ActorConfig,
	type Actions,
} from "./config";
import { ActorInstance } from "./instance";
import { ActorContext } from "./context";
import type { ActionContext } from "./action";

export type AnyActorDefinition = ActorDefinition<any, any, any, any, any>;

/**
 * Extracts the context type from an ActorDefinition
 */
export type ActorContextOf<AD extends AnyActorDefinition> = 
	AD extends ActorDefinition<infer S, infer CP, infer CS, infer V, any> 
		? ActorContext<S, CP, CS, V> 
		: never;

/**
 * Extracts the context type from an ActorDefinition
 */
export type ActionContextOf<AD extends AnyActorDefinition> = 
	AD extends ActorDefinition<infer S, infer CP, infer CS, infer V, any> 
		? ActionContext<S, CP, CS, V> 
		: never;

export class ActorDefinition<S, CP, CS, V, R extends Actions<S, CP, CS, V>> {
	#config: ActorConfig<S, CP, CS, V>;

	constructor(config: ActorConfig<S, CP, CS, V>) {
		this.#config = config;
	}

	instantiate(): ActorInstance<S, CP, CS, V> {
		return new ActorInstance(this.#config);
	}
}
