import { type WorkerConfig, type Actions } from "./config";
import { WorkerInstance } from "./instance";
import { WorkerContext } from "./context";
import type { ActionContext } from "./action";

export type AnyWorkerDefinition = WorkerDefinition<
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
		any
	>
		? WorkerContext<S, CP, CS, V, I, AD>
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
		any
	>
		? ActionContext<S, CP, CS, V, I, AD>
		: never;

export class WorkerDefinition<
	S,
	CP,
	CS,
	V,
	I,
	AD,
	R extends Actions<S, CP, CS, V, I, AD>,
> {
	#config: WorkerConfig<S, CP, CS, V, I, AD>;

	constructor(config: WorkerConfig<S, CP, CS, V, I, AD>) {
		this.#config = config;
	}

	get config(): WorkerConfig<S, CP, CS, V, I, AD> {
		return this.#config;
	}

	instantiate(): WorkerInstance<S, CP, CS, V, I, AD> {
		return new WorkerInstance(this.#config);
	}
}
