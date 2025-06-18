import type { WorkerConfig, Actions } from "./config";
import { WorkerInstance } from "./instance";
import type { WorkerContext } from "./context";
import type { ActionContext } from "./action";

export type AnyWorkerDefinition = WorkerDefinition<
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
 * Extracts the context type from an WorkerDefinition
 */
export type WorkerContextOf<AD extends AnyWorkerDefinition> =
	AD extends WorkerDefinition<
		infer S,
		infer CP,
		infer CS,
		infer V,
		infer I,
		infer AD,
		infer DB,
		any
	>
		? WorkerContext<S, CP, CS, V, I, AD, DB>
		: never;

/**
 * Extracts the context type from an WorkerDefinition
 */
export type ActionContextOf<AD extends AnyWorkerDefinition> =
	AD extends WorkerDefinition<
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

export class WorkerDefinition<
	S,
	CP,
	CS,
	V,
	I,
	AD,
	DB,
	R extends Actions<S, CP, CS, V, I, AD, DB>,
> {
	#config: WorkerConfig<S, CP, CS, V, I, AD, DB>;

	constructor(config: WorkerConfig<S, CP, CS, V, I, AD, DB>) {
		this.#config = config;
	}

	get config(): WorkerConfig<S, CP, CS, V, I, AD, DB> {
		return this.#config;
	}

	instantiate(): WorkerInstance<S, CP, CS, V, I, AD, DB> {
		return new WorkerInstance(this.#config);
	}
}
