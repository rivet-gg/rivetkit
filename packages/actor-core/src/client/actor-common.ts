import type { AnyActorDefinition, ActorDefinition } from "@/actor/definition";
import type * as protoHttpResolve from "@/actor/protocol/http/resolve";
import type { Encoding } from "@/actor/protocol/serde";
import type { ActorQuery } from "@/manager/protocol/query";
import { logger } from "./log";
import * as errors from "./errors";
import { sendHttpRequest } from "./utils";
import { HEADER_ACTOR_QUERY, HEADER_ENCODING } from "@/actor/router-endpoints";

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
	AD extends ActorDefinition<any, any, any, any, infer R>
		? {
				[K in keyof R]: R[K] extends (...args: infer Args) => infer Return
					? ActorRPCFunction<Args, Return>
					: never;
			}
		: never;

/**
 * Resolves an actor ID from a query by making a request to the /actors/resolve endpoint
 *
 * @param {string} endpoint - The manager endpoint URL
 * @param {ActorQuery} actorQuery - The query to resolve
 * @param {Encoding} encodingKind - The encoding to use (json or cbor)
 * @returns {Promise<string>} - A promise that resolves to the actor's ID
 */
export async function resolveActorId(
	endpoint: string,
	actorQuery: ActorQuery,
	encodingKind: Encoding,
): Promise<string> {
	logger().debug("resolving actor ID", { query: actorQuery });

	try {
		const result = await sendHttpRequest<
			Record<never, never>,
			protoHttpResolve.ResolveResponse
		>({
			url: `${endpoint}/actors/resolve`,
			method: "POST",
			headers: {
				[HEADER_ENCODING]: encodingKind,
				[HEADER_ACTOR_QUERY]: JSON.stringify(actorQuery),
			},
			body: {},
			encoding: encodingKind,
		});

		logger().debug("resolved actor ID", { actorId: result.i });
		return result.i;
	} catch (error) {
		logger().error("failed to resolve actor ID", { error });
		if (error instanceof errors.ActorError) {
			throw error;
		} else {
			throw new errors.InternalError(
				`Failed to resolve actor ID: ${String(error)}`,
			);
		}
	}
}
