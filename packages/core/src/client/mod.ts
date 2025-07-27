import type { Registry } from "@/registry/mod";
import {
	type Client,
	type ClientOptions,
	createClientWithDriver,
} from "./client";
import { createHttpClientDriver } from "./http-client-driver";

export {
	ActorDefinition,
	AnyActorDefinition,
} from "@/actor/definition";
export type { Transport } from "@/actor/protocol/message/mod";
export type { Encoding } from "@/actor/protocol/serde";
export {
	ActorClientError,
	ActorError,
	InternalError,
	MalformedResponseMessage,
	ManagerError,
} from "@/client/errors";
export type { CreateRequest } from "@/manager/protocol/query";
export type { ActorActionFunction } from "./actor-common";
export type { ActorConn, EventUnsubscribe } from "./actor-conn";
export { ActorConnRaw } from "./actor-conn";
export type { ActorHandle } from "./actor-handle";
export { ActorHandleRaw } from "./actor-handle";
export type {
	ActorAccessor,
	Client,
	ClientOptions,
	ClientRaw,
	CreateOptions,
	ExtractActorsFromRegistry,
	ExtractRegistryFromClient,
	GetOptions,
	GetWithIdOptions,
	QueryOptions,
	Region,
} from "./client";

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
