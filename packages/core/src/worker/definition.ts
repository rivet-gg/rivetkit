import {
	type WorkerConfig,
	type Actions,
} from "./config";
import { WorkerInstance } from "./instance";
import { WorkerContext } from "./context";
import type { ActionContext } from "./action";

export type AnyWorkerDefinition = WorkerDefinition<any, any, any, any, any>;

/**
 * Extracts the context type from an WorkerDefinition
 */
export type WorkerContextOf<AD extends AnyWorkerDefinition> = 
	AD extends WorkerDefinition<infer S, infer CP, infer CS, infer V, any> 
		? WorkerContext<S, CP, CS, V> 
		: never;

/**
 * Extracts the context type from an WorkerDefinition
 */
export type ActionContextOf<AD extends AnyWorkerDefinition> = 
	AD extends WorkerDefinition<infer S, infer CP, infer CS, infer V, any> 
		? ActionContext<S, CP, CS, V> 
		: never;

export class WorkerDefinition<S, CP, CS, V, R extends Actions<S, CP, CS, V>> {
	#config: WorkerConfig<S, CP, CS, V>;

	constructor(config: WorkerConfig<S, CP, CS, V>) {
		this.#config = config;
	}

	get config(): WorkerConfig<S, CP, CS, V> {
		return this.#config;
	}

	instantiate(): WorkerInstance<S, CP, CS, V> {
		return new WorkerInstance(this.#config);
	}
}
