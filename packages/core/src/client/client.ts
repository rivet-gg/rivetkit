import type { Transport } from "@/worker/protocol/message/mod";
import type { Encoding } from "@/worker/protocol/serde";
import type { WorkerQuery } from "@/manager/protocol/query";
import { WorkerConn, WorkerConnRaw, CONNECT_SYMBOL } from "./worker-conn";
import { WorkerHandle, WorkerHandleRaw } from "./worker-handle";
import { WorkerActionFunction } from "./worker-common";
import { logger } from "./log";
import type { Registry } from "@/mod";
import type { AnyWorkerDefinition } from "@/worker/definition";
import type * as wsToServer from "@/worker/protocol/message/to-server";
import type { EventSource } from "eventsource";
import type { Context as HonoContext } from "hono";
import type { WebSocket } from "ws";

/** Extract the worker registry from the registry definition. */
export type ExtractWorkersFromRegistry<A extends Registry<any>> =
	A extends Registry<infer Workers> ? Workers : never;

/** Extract the registry definition from the client. */
export type ExtractRegistryFromClient<C extends Client<Registry<{}>>> =
	C extends Client<infer A> ? A : never;

/**
 * Represents a worker accessor that provides methods to interact with a specific worker.
 */
export interface WorkerAccessor<AD extends AnyWorkerDefinition> {
	/**
	 * Gets a stateless handle to a worker by its key, but does not create the worker if it doesn't exist.
	 * The worker name is automatically injected from the property accessor.
	 *
	 * @template AD The worker class that this handle is for.
	 * @param {string | string[]} [key=[]] - The key to identify the worker. Can be a single string or an array of strings.
	 * @param {GetWithIdOptions} [opts] - Options for getting the worker.
	 * @returns {WorkerHandle<AD>} - A handle to the worker.
	 */
	get(key?: string | string[], opts?: GetWithIdOptions): WorkerHandle<AD>;

	/**
	 * Gets a stateless handle to a worker by its key, creating it if necessary.
	 * The worker name is automatically injected from the property accessor.
	 *
	 * @template AD The worker class that this handle is for.
	 * @param {string | string[]} [key=[]] - The key to identify the worker. Can be a single string or an array of strings.
	 * @param {GetOptions} [opts] - Options for getting the worker.
	 * @returns {WorkerHandle<AD>} - A handle to the worker.
	 */
	getOrCreate(
		key?: string | string[],
		opts?: GetOrCreateOptions,
	): WorkerHandle<AD>;

	/**
	 * Gets a stateless handle to a worker by its ID.
	 *
	 * @template AD The worker class that this handle is for.
	 * @param {string} workerId - The ID of the worker.
	 * @param {GetWithIdOptions} [opts] - Options for getting the worker.
	 * @returns {WorkerHandle<AD>} - A handle to the worker.
	 */
	getForId(workerId: string, opts?: GetWithIdOptions): WorkerHandle<AD>;

	/**
	 * Creates a new worker with the name automatically injected from the property accessor,
	 * and returns a stateless handle to it with the worker ID resolved.
	 *
	 * @template AD The worker class that this handle is for.
	 * @param {string | string[]} key - The key to identify the worker. Can be a single string or an array of strings.
	 * @param {CreateOptions} [opts] - Options for creating the worker (excluding name and key).
	 * @returns {Promise<WorkerHandle<AD>>} - A promise that resolves to a handle to the worker.
	 */
	create(
		key?: string | string[],
		opts?: CreateOptions,
	): Promise<WorkerHandle<AD>>;
}

/**
 * Options for configuring the client.
 * @typedef {Object} ClientOptions
 */
export interface ClientOptions {
	encoding?: Encoding;
	transport?: Transport;
}

/**
 * Options for querying workers.
 * @typedef {Object} QueryOptions
 * @property {unknown} [parameters] - Parameters to pass to the connection.
 */
export interface QueryOptions {
	/** Parameters to pass to the connection. */
	params?: unknown;
}

/**
 * Options for getting a worker by ID.
 * @typedef {QueryOptions} GetWithIdOptions
 */
export interface GetWithIdOptions extends QueryOptions {}

/**
 * Options for getting a worker.
 * @typedef {QueryOptions} GetOptions
 */
export interface GetOptions extends QueryOptions {}

/**
 * Options for getting or creating a worker.
 * @typedef {QueryOptions} GetOrCreateOptions
 * @property {string} [createInRegion] - Region to create the worker in if it doesn't exist.
 */
export interface GetOrCreateOptions extends QueryOptions {
	/** Region to create the worker in if it doesn't exist. */
	createInRegion?: string;
	/** Input data to pass to the worker. */
	createWithInput?: unknown;
}

/**
 * Options for creating a worker.
 * @typedef {QueryOptions} CreateOptions
 * @property {string} [region] - The region to create the worker in.
 */
export interface CreateOptions extends QueryOptions {
	/** The region to create the worker in. */
	region?: string;
	/** Input data to pass to the worker. */
	input?: unknown;
}

/**
 * Represents a region to connect to.
 * @typedef {Object} Region
 * @property {string} id - The region ID.
 * @property {string} name - The region name.
 * @see {@link https://rivet.gg/docs/edge|Edge Networking}
 * @see {@link https://rivet.gg/docs/regions|Available Regions}
 */
export interface Region {
	/**
	 * The region slug.
	 */
	id: string;

	/**
	 * The human-friendly region name.
	 */
	name: string;
}

export const WORKER_CONNS_SYMBOL = Symbol("workerConns");
export const CREATE_WORKER_CONN_PROXY = Symbol("createWorkerConnProxy");
export const TRANSPORT_SYMBOL = Symbol("transport");

export interface ClientDriver {
	action<Args extends Array<unknown> = unknown[], Response = unknown>(
		c: HonoContext | undefined,
		workerQuery: WorkerQuery,
		encoding: Encoding,
		params: unknown,
		name: string,
		...args: Args
	): Promise<Response>;
	resolveWorkerId(
		c: HonoContext | undefined,
		workerQuery: WorkerQuery,
		encodingKind: Encoding,
		params: unknown,
	): Promise<string>;
	connectWebSocket(
		c: HonoContext | undefined,
		workerQuery: WorkerQuery,
		encodingKind: Encoding,
		params: unknown,
	): Promise<WebSocket>;
	connectSse(
		c: HonoContext | undefined,
		workerQuery: WorkerQuery,
		encodingKind: Encoding,
		params: unknown,
	): Promise<EventSource>;
	sendHttpMessage(
		c: HonoContext | undefined,
		workerId: string,
		encoding: Encoding,
		connectionId: string,
		connectionToken: string,
		message: wsToServer.ToServer,
	): Promise<Response>;
}

/**
 * Client for managing & connecting to workers.
 *
 * @template A The workers map type that defines the available workers.
 * @see {@link https://rivet.gg/docs/manage|Create & Manage Workers}
 */
export class ClientRaw {
	#disposed = false;

	[WORKER_CONNS_SYMBOL] = new Set<WorkerConnRaw>();

	#driver: ClientDriver;
	#encodingKind: Encoding;
	[TRANSPORT_SYMBOL]: Transport;

	/**
	 * Creates an instance of Client.
	 *
	 * @param {string} managerEndpoint - The manager endpoint. See {@link https://rivet.gg/docs/setup|Initial Setup} for instructions on getting the manager endpoint.
	 * @param {ClientOptions} [opts] - Options for configuring the client.
	 * @see {@link https://rivet.gg/docs/setup|Initial Setup}
	 */
	public constructor(driver: ClientDriver, opts?: ClientOptions) {
		this.#driver = driver;

		this.#encodingKind = opts?.encoding ?? "cbor";
		this[TRANSPORT_SYMBOL] = opts?.transport ?? "websocket";
	}

	/**
	 * Gets a stateless handle to a worker by its ID.
	 *
	 * @template AD The worker class that this handle is for.
	 * @param {string} name - The name of the worker.
	 * @param {string} workerId - The ID of the worker.
	 * @param {GetWithIdOptions} [opts] - Options for getting the worker.
	 * @returns {WorkerHandle<AD>} - A handle to the worker.
	 */
	getForId<AD extends AnyWorkerDefinition>(
		name: string,
		workerId: string,
		opts?: GetWithIdOptions,
	): WorkerHandle<AD> {
		logger().debug("get handle to worker with id", {
			name,
			workerId,
			params: opts?.params,
		});

		const workerQuery = {
			getForId: {
				workerId,
			},
		};

		const handle = this.#createHandle(opts?.params, workerQuery);
		return createWorkerProxy(handle) as WorkerHandle<AD>;
	}

	/**
	 * Gets a stateless handle to a worker by its key, but does not create the worker if it doesn't exist.
	 *
	 * @template AD The worker class that this handle is for.
	 * @param {string} name - The name of the worker.
	 * @param {string | string[]} [key=[]] - The key to identify the worker. Can be a single string or an array of strings.
	 * @param {GetWithIdOptions} [opts] - Options for getting the worker.
	 * @returns {WorkerHandle<AD>} - A handle to the worker.
	 */
	get<AD extends AnyWorkerDefinition>(
		name: string,
		key?: string | string[],
		opts?: GetWithIdOptions,
	): WorkerHandle<AD> {
		// Convert string to array of strings
		const keyArray: string[] = typeof key === "string" ? [key] : key || [];

		logger().debug("get handle to worker", {
			name,
			key: keyArray,
			parameters: opts?.params,
		});

		const workerQuery: WorkerQuery = {
			getForKey: {
				name,
				key: keyArray,
			},
		};

		const handle = this.#createHandle(opts?.params, workerQuery);
		return createWorkerProxy(handle) as WorkerHandle<AD>;
	}

	/**
	 * Gets a stateless handle to a worker by its key, creating it if necessary.
	 *
	 * @template AD The worker class that this handle is for.
	 * @param {string} name - The name of the worker.
	 * @param {string | string[]} [key=[]] - The key to identify the worker. Can be a single string or an array of strings.
	 * @param {GetOptions} [opts] - Options for getting the worker.
	 * @returns {WorkerHandle<AD>} - A handle to the worker.
	 */
	getOrCreate<AD extends AnyWorkerDefinition>(
		name: string,
		key?: string | string[],
		opts?: GetOrCreateOptions,
	): WorkerHandle<AD> {
		// Convert string to array of strings
		const keyArray: string[] = typeof key === "string" ? [key] : key || [];

		logger().debug("get or create handle to worker", {
			name,
			key: keyArray,
			parameters: opts?.params,
			createInRegion: opts?.createInRegion,
		});

		const workerQuery: WorkerQuery = {
			getOrCreateForKey: {
				name,
				key: keyArray,
				input: opts?.createWithInput,
				region: opts?.createInRegion,
			},
		};

		const handle = this.#createHandle(opts?.params, workerQuery);
		return createWorkerProxy(handle) as WorkerHandle<AD>;
	}

	/**
	 * Creates a new worker with the provided key and returns a stateless handle to it.
	 * Resolves the worker ID and returns a handle with getForId query.
	 *
	 * @template AD The worker class that this handle is for.
	 * @param {string} name - The name of the worker.
	 * @param {string | string[]} key - The key to identify the worker. Can be a single string or an array of strings.
	 * @param {CreateOptions} [opts] - Options for creating the worker (excluding name and key).
	 * @returns {Promise<WorkerHandle<AD>>} - A promise that resolves to a handle to the worker.
	 */
	async create<AD extends AnyWorkerDefinition>(
		name: string,
		key?: string | string[],
		opts?: CreateOptions,
	): Promise<WorkerHandle<AD>> {
		// Convert string to array of strings
		const keyArray: string[] = typeof key === "string" ? [key] : key || [];

		const createQuery = {
			create: {
				...opts,
				// Do these last to override `opts`
				name,
				key: keyArray,
			},
		} satisfies WorkerQuery;

		logger().debug("create worker handle", {
			name,
			key: keyArray,
			parameters: opts?.params,
			create: createQuery.create,
		});

		// Create the worker
		const workerId = await this.#driver.resolveWorkerId(
			undefined,
			createQuery,
			this.#encodingKind,
			opts?.params,
		);
		logger().debug("created worker with ID", {
			name,
			key: keyArray,
			workerId,
		});

		// Create handle with worker ID
		const getForIdQuery = {
			getForId: {
				workerId,
			},
		} satisfies WorkerQuery;
		const handle = this.#createHandle(opts?.params, getForIdQuery);

		const proxy = createWorkerProxy(handle) as WorkerHandle<AD>;

		return proxy;
	}

	#createHandle(params: unknown, workerQuery: WorkerQuery): WorkerHandleRaw {
		return new WorkerHandleRaw(
			this,
			this.#driver,
			params,
			this.#encodingKind,
			workerQuery,
		);
	}

	[CREATE_WORKER_CONN_PROXY]<AD extends AnyWorkerDefinition>(
		conn: WorkerConnRaw,
	): WorkerConn<AD> {
		// Save to connection list
		this[WORKER_CONNS_SYMBOL].add(conn);

		// Start connection
		conn[CONNECT_SYMBOL]();

		return createWorkerProxy(conn) as WorkerConn<AD>;
	}

	/**
	 * Disconnects from all workers.
	 *
	 * @returns {Promise<void>} A promise that resolves when all connections are closed.
	 */
	async dispose(): Promise<void> {
		if (this.#disposed) {
			logger().warn("client already disconnected");
			return;
		}
		this.#disposed = true;

		logger().debug("disposing client");

		const disposePromises = [];

		// Dispose all connections
		for (const conn of this[WORKER_CONNS_SYMBOL].values()) {
			disposePromises.push(conn.dispose());
		}

		await Promise.all(disposePromises);
	}
}

/**
 * Client type with worker accessors.
 * This adds property accessors for worker names to the ClientRaw base class.
 *
 * @template A The worker registry type.
 */
export type Client<A extends Registry<any>> = ClientRaw & {
	[K in keyof ExtractWorkersFromRegistry<A>]: WorkerAccessor<
		ExtractWorkersFromRegistry<A>[K]
	>;
};

export function createClientWithDriver<A extends Registry<any>>(
	driver: ClientDriver,
	opts?: ClientOptions,
): Client<A> {
	const client = new ClientRaw(driver, opts);

	// Create proxy for accessing workers by name
	return new Proxy(client, {
		get: (target: ClientRaw, prop: string | symbol, receiver: unknown) => {
			// Get the real property if it exists
			if (typeof prop === "symbol" || prop in target) {
				const value = Reflect.get(target, prop, receiver);
				// Preserve method binding
				if (typeof value === "function") {
					return value.bind(target);
				}
				return value;
			}

			// Handle worker accessor for string properties (worker names)
			if (typeof prop === "string") {
				// Return worker accessor object with methods
				return {
					// Handle methods (stateless action)
					get: (
						key?: string | string[],
						opts?: GetWithIdOptions,
					): WorkerHandle<ExtractWorkersFromRegistry<A>[typeof prop]> => {
						return target.get<ExtractWorkersFromRegistry<A>[typeof prop]>(
							prop,
							key,
							opts,
						);
					},
					getOrCreate: (
						key?: string | string[],
						opts?: GetOptions,
					): WorkerHandle<ExtractWorkersFromRegistry<A>[typeof prop]> => {
						return target.getOrCreate<
							ExtractWorkersFromRegistry<A>[typeof prop]
						>(prop, key, opts);
					},
					getForId: (
						workerId: string,
						opts?: GetWithIdOptions,
					): WorkerHandle<ExtractWorkersFromRegistry<A>[typeof prop]> => {
						return target.getForId<ExtractWorkersFromRegistry<A>[typeof prop]>(
							prop,
							workerId,
							opts,
						);
					},
					create: async (
						key: string | string[],
						opts: CreateOptions = {},
					): Promise<
						WorkerHandle<ExtractWorkersFromRegistry<A>[typeof prop]>
					> => {
						return await target.create<
							ExtractWorkersFromRegistry<A>[typeof prop]
						>(prop, key, opts);
					},
				} as WorkerAccessor<ExtractWorkersFromRegistry<A>[typeof prop]>;
			}

			return undefined;
		},
	}) as Client<A>;
}

/**
 * Creates a proxy for a worker that enables calling actions without explicitly using `.action`.
 **/
function createWorkerProxy<AD extends AnyWorkerDefinition>(
	handle: WorkerHandleRaw | WorkerConnRaw,
): WorkerHandle<AD> | WorkerConn<AD> {
	// Stores returned action functions for faster calls
	const methodCache = new Map<string, WorkerActionFunction>();
	return new Proxy(handle, {
		get(target: WorkerHandleRaw, prop: string | symbol, receiver: unknown) {
			// Handle built-in Symbol properties
			if (typeof prop === "symbol") {
				return Reflect.get(target, prop, receiver);
			}

			// Handle built-in Promise methods and existing properties
			if (prop === "constructor" || prop in target) {
				const value = Reflect.get(target, prop, receiver);
				// Preserve method binding
				if (typeof value === "function") {
					return value.bind(target);
				}
				return value;
			}

			// Create action function that preserves 'this' context
			if (typeof prop === "string") {
				// If JS is attempting to calling this as a promise, ignore it
				if (prop === "then") return undefined;

				let method = methodCache.get(prop);
				if (!method) {
					method = (...args: unknown[]) => target.action(prop, ...args);
					methodCache.set(prop, method);
				}
				return method;
			}
		},

		// Support for 'in' operator
		has(target: WorkerHandleRaw, prop: string | symbol) {
			// All string properties are potentially action functions
			if (typeof prop === "string") {
				return true;
			}
			// For symbols, defer to the target's own has behavior
			return Reflect.has(target, prop);
		},

		// Support instanceof checks
		getPrototypeOf(target: WorkerHandleRaw) {
			return Reflect.getPrototypeOf(target);
		},

		// Prevent property enumeration of non-existent action methods
		ownKeys(target: WorkerHandleRaw) {
			return Reflect.ownKeys(target);
		},

		// Support proper property descriptors
		getOwnPropertyDescriptor(target: WorkerHandleRaw, prop: string | symbol) {
			const targetDescriptor = Reflect.getOwnPropertyDescriptor(target, prop);
			if (targetDescriptor) {
				return targetDescriptor;
			}
			if (typeof prop === "string") {
				// Make action methods appear non-enumerable
				return {
					configurable: true,
					enumerable: false,
					writable: false,
					value: (...args: unknown[]) => target.action(prop, ...args),
				};
			}
			return undefined;
		},
	}) as WorkerHandle<AD> | WorkerConn<AD>;
}
