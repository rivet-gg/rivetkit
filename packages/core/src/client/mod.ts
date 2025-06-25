import type { Registry } from "@/registry/mod";
import { type Client, type ClientOptions, createClientWithDriver } from "./client";
import { createHttpClientDriver } from "./http-client-driver";

export type {
	Client,
	ActorAccessor,
	ClientOptions,
	CreateOptions,
	GetOptions,
	GetWithIdOptions,
	QueryOptions,
	Region,
	ExtractActorsFromRegistry,
	ExtractRegistryFromClient,
	ClientRaw,
} from "./client";
export type { ActorConn } from  "./actor-conn";
export { ActorConnRaw } from  "./actor-conn";
export type { EventUnsubscribe } from  "./actor-conn";
export type { ActorHandle } from  "./actor-handle";
export { ActorHandleRaw } from  "./actor-handle";
export type { ActorActionFunction } from  "./actor-common";
export type { Transport } from  "@/actor/protocol/message/mod";
export type { Encoding } from  "@/actor/protocol/serde";
export type { CreateRequest } from "@/manager/protocol/query";
export {
	ActorClientError,
	InternalError,
	ManagerError,
	ConnParamsTooLong,
	MalformedResponseMessage,
	ActorError,
} from "@/client/errors";
export {
	AnyActorDefinition,
	ActorDefinition,
} from  "@/actor/definition";

/**
 * Creates a client with the actor accessor proxy.
 *
 * @template A The actor application type.
 * @param {string} managerEndpoint - The manager endpoint.
 * @param {ClientOptions} [opts] - Options for configuring the client.
 * @returns {Client<A>} - A proxied client that supports the `client.myActor.connect()` syntax.
 */
export function createClient<A extends Registry<any>>(
	endpoint: string,
	opts?: ClientOptions,
): Client<A> {
	const driver = createHttpClientDriver(endpoint);
	return createClientWithDriver<A>(driver, opts);
}
