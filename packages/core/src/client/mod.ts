import type { Registry } from "@/registry/mod";
import { type Client, type ClientOptions, createClientWithDriver } from "./client";
import { createHttpClientDriver } from "./http-client-driver";

export type {
	Client,
	WorkerAccessor,
	ClientOptions,
	CreateOptions,
	GetOptions,
	GetWithIdOptions,
	QueryOptions,
	Region,
	ExtractWorkersFromRegistry,
	ExtractRegistryFromClient,
	ClientRaw,
} from "./client";
export type { WorkerConn } from "./worker-conn";
export { WorkerConnRaw } from "./worker-conn";
export type { EventUnsubscribe } from "./worker-conn";
export type { WorkerHandle } from "./worker-handle";
export { WorkerHandleRaw } from "./worker-handle";
export type { WorkerActionFunction } from "./worker-common";
export type { Transport } from "@/worker/protocol/message/mod";
export type { Encoding } from "@/worker/protocol/serde";
export type { CreateRequest } from "@/manager/protocol/query";
export {
	WorkerClientError,
	InternalError,
	ManagerError,
	ConnParamsTooLong,
	MalformedResponseMessage,
	WorkerError,
} from "@/client/errors";
export {
	AnyWorkerDefinition,
	WorkerDefinition,
} from "@/worker/definition";

/**
 * Creates a client with the worker accessor proxy.
 *
 * @template A The worker application type.
 * @param {string} managerEndpoint - The manager endpoint.
 * @param {ClientOptions} [opts] - Options for configuring the client.
 * @returns {Client<A>} - A proxied client that supports the `client.myWorker.connect()` syntax.
 */
export function createClient<A extends Registry<any>>(
	endpoint: string,
	opts?: ClientOptions,
): Client<A> {
	const driver = createHttpClientDriver(endpoint);
	return createClientWithDriver<A>(driver, opts);
}
