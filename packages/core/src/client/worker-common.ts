import type {
	AnyWorkerDefinition,
	WorkerDefinition,
} from "@/worker/definition";

/**
 * Action function returned by Worker connections and handles.
 *
 * @typedef {Function} WorkerActionFunction
 * @template Args
 * @template Response
 * @param {...Args} args - Arguments for the action function.
 * @returns {Promise<Response>}
 */
export type WorkerActionFunction<
	Args extends Array<unknown> = unknown[],
	Response = unknown,
> = (
	...args: Args extends [unknown, ...infer Rest] ? Rest : Args
) => Promise<Response>;

/**
 * Maps action methods from worker definition to typed function signatures.
 */
export type WorkerDefinitionActions<AD extends AnyWorkerDefinition> =
	// biome-ignore lint/suspicious/noExplicitAny: safe to use any here
	AD extends WorkerDefinition<any, any, any, any, any, any, any, infer R>
		? {
				[K in keyof R]: R[K] extends (...args: infer Args) => infer Return
					? WorkerActionFunction<Args, Return>
					: never;
			}
		: never;
