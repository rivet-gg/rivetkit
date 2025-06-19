import type {
	AnyWorkerDefinition,
	WorkerDefinition,
} from "@/worker/definition";
import type * as protoHttpResolve from "@/worker/protocol/http/resolve";
import type { Encoding } from "@/worker/protocol/serde";
import type { WorkerQuery } from "@/manager/protocol/query";
import { logger } from "./log";
import * as errors from "./errors";
import { sendHttpRequest } from "./utils";
import {
	HEADER_WORKER_QUERY,
	HEADER_ENCODING,
} from "@/worker/router-endpoints";

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
	AD extends WorkerDefinition<any, any, any, any, any, any, infer R>
		? {
				[K in keyof R]: R[K] extends (...args: infer Args) => infer Return
					? WorkerActionFunction<Args, Return>
					: never;
			}
		: never;
