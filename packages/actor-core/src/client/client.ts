import type { Transport } from "@/actor/protocol/message/mod";
import type { Encoding } from "@/actor/protocol/serde";
import type { ActorQuery } from "@/manager/protocol/query";
import * as errors from "./errors";
import { ActorConn, ActorConnRaw, CONNECT_SYMBOL } from "./actor-conn";
import { ActorHandle, ActorHandleRaw } from "./actor-handle";
import { ActorActionFunction, resolveActorId } from "./actor-common";
import { logger } from "./log";
import type { ActorCoreApp } from "@/mod";
import type { AnyActorDefinition } from "@/actor/definition";

/** Extract the actor registry from the app definition. */
export type ExtractActorsFromApp<A extends ActorCoreApp<any>> =
	A extends ActorCoreApp<infer Actors> ? Actors : never;

/** Extract the app definition from the client. */
export type ExtractAppFromClient<C extends Client<ActorCoreApp<{}>>> =
	C extends Client<infer A> ? A : never;

/**
 * Represents an actor accessor that provides methods to interact with a specific actor.
 */
export interface ActorAccessor<AD extends AnyActorDefinition> {
	/**
	 * Gets a stateless handle to an actor by its key, but does not create the actor if it doesn't exist.
	 * The actor name is automatically injected from the property accessor.
	 *
	 * @template AD The actor class that this handle is for.
	 * @param {string | string[]} [key=[]] - The key to identify the actor. Can be a single string or an array of strings.
	 * @param {GetWithIdOptions} [opts] - Options for getting the actor.
	 * @returns {ActorHandle<AD>} - A handle to the actor.
	 */
	get(key?: string | string[], opts?: GetWithIdOptions): ActorHandle<AD>;

	/**
	 * Gets a stateless handle to an actor by its key, creating it if necessary.
	 * The actor name is automatically injected from the property accessor.
	 *
	 * @template AD The actor class that this handle is for.
	 * @param {string | string[]} [key=[]] - The key to identify the actor. Can be a single string or an array of strings.
	 * @param {GetOptions} [opts] - Options for getting the actor.
	 * @returns {ActorHandle<AD>} - A handle to the actor.
	 */
	getOrCreate(
		key?: string | string[],
		opts?: GetOrCreateOptions,
	): ActorHandle<AD>;

	/**
	 * Gets a stateless handle to an actor by its ID.
	 *
	 * @template AD The actor class that this handle is for.
	 * @param {string} actorId - The ID of the actor.
	 * @param {GetWithIdOptions} [opts] - Options for getting the actor.
	 * @returns {ActorHandle<AD>} - A handle to the actor.
	 */
	getForId(actorId: string, opts?: GetWithIdOptions): ActorHandle<AD>;

	/**
	 * Creates a new actor with the name automatically injected from the property accessor,
	 * and returns a stateless handle to it with the actor ID resolved.
	 *
	 * @template AD The actor class that this handle is for.
	 * @param {string | string[]} key - The key to identify the actor. Can be a single string or an array of strings.
	 * @param {CreateOptions} [opts] - Options for creating the actor (excluding name and key).
	 * @returns {Promise<ActorHandle<AD>>} - A promise that resolves to a handle to the actor.
	 */
	create(
		key?: string | string[],
		opts?: CreateOptions,
	): Promise<ActorHandle<AD>>;
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
 * Options for querying actors.
 * @typedef {Object} QueryOptions
 * @property {unknown} [parameters] - Parameters to pass to the connection.
 */
export interface QueryOptions {
	/** Parameters to pass to the connection. */
	params?: unknown;
}

/**
 * Options for getting an actor by ID.
 * @typedef {QueryOptions} GetWithIdOptions
 */
export interface GetWithIdOptions extends QueryOptions {}

/**
 * Options for getting an actor.
 * @typedef {QueryOptions} GetOptions
 */
export interface GetOptions extends QueryOptions {}

/**
 * Options for getting or creating an actor.
 * @typedef {QueryOptions} GetOrCreateOptions
 * @property {string} [createInRegion] - Region to create the actor in if it doesn't exist.
 */
export interface GetOrCreateOptions extends QueryOptions {
	/** Region to create the actor in if it doesn't exist. */
	createInRegion?: string;
	/** Input data to pass to the actor. */
	createWithInput?: unknown;
}

/**
 * Options for creating an actor.
 * @typedef {QueryOptions} CreateOptions
 * @property {string} [region] - The region to create the actor in.
 */
export interface CreateOptions extends QueryOptions {
	/** The region to create the actor in. */
	region?: string;
	/** Input data to pass to the actor. */
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

export const ACTOR_CONNS_SYMBOL = Symbol("actorConns");
export const CREATE_ACTOR_CONN_PROXY = Symbol("createActorConnProxy");
export const TRANSPORT_SYMBOL = Symbol("transport");

/**
 * Client for managing & connecting to actors.
 *
 * @template A The actors map type that defines the available actors.
 * @see {@link https://rivet.gg/docs/manage|Create & Manage Actors}
 */
export class ClientRaw {
	#disposed = false;

	[ACTOR_CONNS_SYMBOL] = new Set<ActorConnRaw>();

	#managerEndpoint: string;
	#encodingKind: Encoding;
	[TRANSPORT_SYMBOL]: Transport;

	/**
	 * Creates an instance of Client.
	 *
	 * @param {string} managerEndpoint - The manager endpoint. See {@link https://rivet.gg/docs/setup|Initial Setup} for instructions on getting the manager endpoint.
	 * @param {ClientOptions} [opts] - Options for configuring the client.
	 * @see {@link https://rivet.gg/docs/setup|Initial Setup}
	 */
	public constructor(managerEndpoint: string, opts?: ClientOptions) {
		this.#managerEndpoint = managerEndpoint;

		this.#encodingKind = opts?.encoding ?? "cbor";
		this[TRANSPORT_SYMBOL] = opts?.transport ?? "websocket";
	}

	/**
	 * Gets a stateless handle to an actor by its ID.
	 *
	 * @template AD The actor class that this handle is for.
	 * @param {string} name - The name of the actor.
	 * @param {string} actorId - The ID of the actor.
	 * @param {GetWithIdOptions} [opts] - Options for getting the actor.
	 * @returns {ActorHandle<AD>} - A handle to the actor.
	 */
	getForId<AD extends AnyActorDefinition>(
		name: string,
		actorId: string,
		opts?: GetWithIdOptions,
	): ActorHandle<AD> {
		logger().debug("get handle to actor with id", {
			name,
			actorId,
			params: opts?.params,
		});

		const actorQuery = {
			getForId: {
				actorId,
			},
		};

		const managerEndpoint = this.#managerEndpoint;
		const handle = this.#createHandle(
			managerEndpoint,
			opts?.params,
			actorQuery,
		);
		return createActorProxy(handle) as ActorHandle<AD>;
	}

	/**
	 * Gets a stateless handle to an actor by its key, but does not create the actor if it doesn't exist.
	 *
	 * @template AD The actor class that this handle is for.
	 * @param {string} name - The name of the actor.
	 * @param {string | string[]} [key=[]] - The key to identify the actor. Can be a single string or an array of strings.
	 * @param {GetWithIdOptions} [opts] - Options for getting the actor.
	 * @returns {ActorHandle<AD>} - A handle to the actor.
	 */
	get<AD extends AnyActorDefinition>(
		name: string,
		key?: string | string[],
		opts?: GetWithIdOptions,
	): ActorHandle<AD> {
		// Convert string to array of strings
		const keyArray: string[] = typeof key === "string" ? [key] : key || [];

		logger().debug("get handle to actor", {
			name,
			key: keyArray,
			parameters: opts?.params,
		});

		const actorQuery: ActorQuery = {
			getForKey: {
				name,
				key: keyArray,
			},
		};

		const managerEndpoint = this.#managerEndpoint;
		const handle = this.#createHandle(
			managerEndpoint,
			opts?.params,
			actorQuery,
		);
		return createActorProxy(handle) as ActorHandle<AD>;
	}

	/**
	 * Gets a stateless handle to an actor by its key, creating it if necessary.
	 *
	 * @template AD The actor class that this handle is for.
	 * @param {string} name - The name of the actor.
	 * @param {string | string[]} [key=[]] - The key to identify the actor. Can be a single string or an array of strings.
	 * @param {GetOptions} [opts] - Options for getting the actor.
	 * @returns {ActorHandle<AD>} - A handle to the actor.
	 */
	getOrCreate<AD extends AnyActorDefinition>(
		name: string,
		key?: string | string[],
		opts?: GetOrCreateOptions,
	): ActorHandle<AD> {
		// Convert string to array of strings
		const keyArray: string[] = typeof key === "string" ? [key] : key || [];

		logger().debug("get or create handle to actor", {
			name,
			key: keyArray,
			parameters: opts?.params,
			createInRegion: opts?.createInRegion,
		});

		const actorQuery: ActorQuery = {
			getOrCreateForKey: {
				name,
				key: keyArray,
				input: opts?.createWithInput,
				region: opts?.createInRegion,
			},
		};

		const managerEndpoint = this.#managerEndpoint;
		const handle = this.#createHandle(
			managerEndpoint,
			opts?.params,
			actorQuery,
		);
		return createActorProxy(handle) as ActorHandle<AD>;
	}

	/**
	 * Creates a new actor with the provided key and returns a stateless handle to it.
	 * Resolves the actor ID and returns a handle with getForId query.
	 *
	 * @template AD The actor class that this handle is for.
	 * @param {string} name - The name of the actor.
	 * @param {string | string[]} key - The key to identify the actor. Can be a single string or an array of strings.
	 * @param {CreateOptions} [opts] - Options for creating the actor (excluding name and key).
	 * @returns {Promise<ActorHandle<AD>>} - A promise that resolves to a handle to the actor.
	 */
	async create<AD extends AnyActorDefinition>(
		name: string,
		key?: string | string[],
		opts?: CreateOptions,
	): Promise<ActorHandle<AD>> {
		// Convert string to array of strings
		const keyArray: string[] = typeof key === "string" ? [key] : key || [];

		const createQuery = {
			create: {
				...opts,
				// Do these last to override `opts`
				name,
				key: keyArray,
			},
		} satisfies ActorQuery;

		logger().debug("create actor handle", {
			name,
			key: keyArray,
			parameters: opts?.params,
			create: createQuery.create,
		});

		// Create the actor
		const actorId = await resolveActorId(
			this.#managerEndpoint,
			createQuery,
			this.#encodingKind,
		);
		logger().debug("created actor with ID", {
			name,
			key: keyArray,
			actorId,
		});

		// Create handle with actor ID
		const getForIdQuery = {
			getForId: {
				actorId,
			},
		} satisfies ActorQuery;
		const handle = this.#createHandle(
			this.#managerEndpoint,
			opts?.params,
			getForIdQuery,
		);

		const proxy = createActorProxy(handle) as ActorHandle<AD>;

		return proxy;
	}

	#createHandle(
		endpoint: string,
		params: unknown,
		actorQuery: ActorQuery,
	): ActorHandleRaw {
		return new ActorHandleRaw(
			this,
			endpoint,
			params,
			this.#encodingKind,
			actorQuery,
		);
	}

	[CREATE_ACTOR_CONN_PROXY]<AD extends AnyActorDefinition>(
		conn: ActorConnRaw,
	): ActorConn<AD> {
		// Save to connection list
		this[ACTOR_CONNS_SYMBOL].add(conn);

		// Start connection
		conn[CONNECT_SYMBOL]();

		return createActorProxy(conn) as ActorConn<AD>;
	}

	/**
	 * Disconnects from all actors.
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
		for (const conn of this[ACTOR_CONNS_SYMBOL].values()) {
			disposePromises.push(conn.dispose());
		}

		await Promise.all(disposePromises);
	}
}

/**
 * Client type with actor accessors.
 * This adds property accessors for actor names to the ClientRaw base class.
 *
 * @template A The actor application type.
 */
export type Client<A extends ActorCoreApp<any>> = ClientRaw & {
	[K in keyof ExtractActorsFromApp<A>]: ActorAccessor<
		ExtractActorsFromApp<A>[K]
	>;
};

/**
 * Creates a client with the actor accessor proxy.
 *
 * @template A The actor application type.
 * @param {string} managerEndpoint - The manager endpoint.
 * @param {ClientOptions} [opts] - Options for configuring the client.
 * @returns {Client<A>} - A proxied client that supports the `client.myActor.connect()` syntax.
 */
export function createClient<A extends ActorCoreApp<any>>(
	managerEndpoint: string,
	opts?: ClientOptions,
): Client<A> {
	const client = new ClientRaw(managerEndpoint, opts);

	// Create proxy for accessing actors by name
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

			// Handle actor accessor for string properties (actor names)
			if (typeof prop === "string") {
				// Return actor accessor object with methods
				return {
					// Handle methods (stateless action)
					get: (
						key?: string | string[],
						opts?: GetWithIdOptions,
					): ActorHandle<ExtractActorsFromApp<A>[typeof prop]> => {
						return target.get<ExtractActorsFromApp<A>[typeof prop]>(
							prop,
							key,
							opts,
						);
					},
					getOrCreate: (
						key?: string | string[],
						opts?: GetOptions,
					): ActorHandle<ExtractActorsFromApp<A>[typeof prop]> => {
						return target.getOrCreate<ExtractActorsFromApp<A>[typeof prop]>(
							prop,
							key,
							opts,
						);
					},
					getForId: (
						actorId: string,
						opts?: GetWithIdOptions,
					): ActorHandle<ExtractActorsFromApp<A>[typeof prop]> => {
						return target.getForId<ExtractActorsFromApp<A>[typeof prop]>(
							prop,
							actorId,
							opts,
						);
					},
					create: async (
						key: string | string[],
						opts: CreateOptions = {},
					): Promise<ActorHandle<ExtractActorsFromApp<A>[typeof prop]>> => {
						return await target.create<ExtractActorsFromApp<A>[typeof prop]>(
							prop,
							key,
							opts,
						);
					},
				} as ActorAccessor<ExtractActorsFromApp<A>[typeof prop]>;
			}

			return undefined;
		},
	}) as Client<A>;
}

/**
 * Creates a proxy for an actor that enables calling actions without explicitly using `.action`.
 **/
function createActorProxy<AD extends AnyActorDefinition>(
	handle: ActorHandleRaw | ActorConnRaw,
): ActorHandle<AD> | ActorConn<AD> {
	// Stores returned action functions for faster calls
	const methodCache = new Map<string, ActorActionFunction>();
	return new Proxy(handle, {
		get(target: ActorHandleRaw, prop: string | symbol, receiver: unknown) {
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
		has(target: ActorHandleRaw, prop: string | symbol) {
			// All string properties are potentially action functions
			if (typeof prop === "string") {
				return true;
			}
			// For symbols, defer to the target's own has behavior
			return Reflect.has(target, prop);
		},

		// Support instanceof checks
		getPrototypeOf(target: ActorHandleRaw) {
			return Reflect.getPrototypeOf(target);
		},

		// Prevent property enumeration of non-existent action methods
		ownKeys(target: ActorHandleRaw) {
			return Reflect.ownKeys(target);
		},

		// Support proper property descriptors
		getOwnPropertyDescriptor(target: ActorHandleRaw, prop: string | symbol) {
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
	}) as ActorHandle<AD> | ActorConn<AD>;
}
