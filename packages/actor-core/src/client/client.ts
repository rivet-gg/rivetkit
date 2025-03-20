import type { Transport } from "@/actor/protocol/message/mod";
import type { Encoding } from "@/actor/protocol/serde";
import type { ActorTags } from "@/common//utils";
import type {
	ActorsRequest,
	ActorsResponse,
	//RivetConfigResponse,
} from "@/manager/protocol/mod";
import type { CreateRequest } from "@/manager/protocol/query";
import * as errors from "./errors";
import {
	ActorHandle,
	ActorHandleRaw,
	ActorRPCFunction,
	CONNECT_SYMBOL,
} from "./handle";
import { logger } from "./log";
import { importWebSocket } from "@/common/websocket";
import { importEventSource } from "@/common/eventsource";
import { ActorCoreApp } from "@/mod";
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
	 * Gets an actor by its tags, creating it if necessary.
	 * The actor name is automatically injected from the property accessor.
	 *
	 * @template A The actor class that this handle is connected to.
	 * @param {Omit<GetOptions, 'name'>} [opts] - Options for getting the actor.
	 * @returns {Promise<ActorHandle<AD>>} - A promise resolving to the actor handle.
	 */
	get(opts?: Omit<GetOptions, "name">): Promise<ActorHandle<AD>>;

	/**
	 * Creates a new actor with the name automatically injected from the property accessor.
	 *
	 * @template A The actor class that this handle is connected to.
	 * @param {Omit<CreateOptions, 'name'>} opts - Options for creating the actor.
	 * @returns {Promise<ActorHandle<AD>>} - A promise resolving to the actor handle.
	 */
	create(opts: Omit<CreateOptions, "name">): Promise<ActorHandle<AD>>;

	/**
	 * Gets an actor by its ID.
	 *
	 * @template A The actor class that this handle is connected to.
	 * @param {string} actorId - The ID of the actor.
	 * @param {GetWithIdOptions} [opts] - Options for getting the actor.
	 * @returns {Promise<ActorHandle<AD>>} - A promise resolving to the actor handle.
	 */
	getWithId(actorId: string, opts?: GetWithIdOptions): Promise<ActorHandle<AD>>;
}

/**
 * Options for configuring the client.
 * @typedef {Object} ClientOptions
 */
export interface ClientOptions {
	encoding?: Encoding;
	supportedTransports?: Transport[];
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
 * @property {boolean} [noCreate] - Prevents creating a new actor if one does not exist.
 * @property {Partial<CreateRequest>} [create] - Config used to create the actor.
 */
export interface GetOptions extends QueryOptions {
	tags?: ActorTags;
	/** Prevents creating a new actor if one does not exist. */
	noCreate?: boolean;
	/** Config used to create the actor. */
	create?: Partial<Omit<CreateRequest, "name">>;
}

/**
 * Options for creating an actor.
 * @typedef {QueryOptions} CreateOptions
 * @property {CreateRequest} create - Config used to create the actor.
 */
export interface CreateOptions extends QueryOptions {
	/** Config used to create the actor. */
	create: Omit<CreateRequest, "name">;
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

export interface DynamicImports {
	WebSocket: typeof WebSocket;
	EventSource: typeof EventSource;
}

export const ACTOR_HANDLES_SYMBOL = Symbol("actorHandles");

/**
 * Represents an actor accessor that provides methods to interact with a specific actor.
 */
export interface ActorAccessor<AD extends AnyActorDefinition> {
	/**
	 * Gets an actor by its tags, creating it if necessary.
	 * The actor name is automatically injected from the property accessor.
	 *
	 * @template A The actor class that this handle is connected to.
	 * @param {Omit<GetOptions, 'name'>} [opts] - Options for getting the actor.
	 * @returns {Promise<ActorHandle<AD>>} - A promise resolving to the actor handle.
	 */
	get(opts?: GetOptions): Promise<ActorHandle<AD>>;

	/**
	 * Creates a new actor with the name automatically injected from the property accessor.
	 *
	 * @template A The actor class that this handle is connected to.
	 * @param {Omit<CreateOptions, 'name'>} opts - Options for creating the actor.
	 * @returns {Promise<ActorHandle<AD>>} - A promise resolving to the actor handle.
	 */
	create(opts: CreateOptions): Promise<ActorHandle<AD>>;

	/**
	 * Gets an actor by its ID.
	 *
	 * @template A The actor class that this handle is connected to.
	 * @param {string} actorId - The ID of the actor.
	 * @param {GetWithIdOptions} [opts] - Options for getting the actor.
	 * @returns {Promise<ActorHandle<AD>>} - A promise resolving to the actor handle.
	 */
	getWithId(actorId: string, opts?: GetWithIdOptions): Promise<ActorHandle<AD>>;
}

/**
 * Client for managing & connecting to actors.
 *
 * @template A The actors map type that defines the available actors.
 * @see {@link https://rivet.gg/docs/manage|Create & Manage Actors}
 */
export class ClientRaw {
	#disposed = false;

	[ACTOR_HANDLES_SYMBOL] = new Set<ActorHandleRaw>();

	#managerEndpointPromise: Promise<string>;
	//#regionPromise: Promise<Region | undefined>;
	#encodingKind: Encoding;
	#supportedTransports: Transport[];

	// External imports
	#dynamicImportsPromise: Promise<DynamicImports>;

	/**
	 * Creates an instance of Client.
	 *
	 * @param {string | Promise<string>} managerEndpointPromise - The manager endpoint or a promise resolving to it. See {@link https://rivet.gg/docs/setup|Initial Setup} for instructions on getting the manager endpoint.
	 * @param {ClientOptions} [opts] - Options for configuring the client.
	 * @see {@link https://rivet.gg/docs/setup|Initial Setup}
	 */
	public constructor(
		managerEndpointPromise: string | Promise<string>,
		opts?: ClientOptions,
	) {
		if (managerEndpointPromise instanceof Promise) {
			// Save promise
			this.#managerEndpointPromise = managerEndpointPromise;
		} else {
			// Convert to promise
			this.#managerEndpointPromise = new Promise((resolve) =>
				resolve(managerEndpointPromise),
			);
		}

		//this.#regionPromise = this.#fetchRegion();

		this.#encodingKind = opts?.encoding ?? "cbor";
		this.#supportedTransports = opts?.supportedTransports ?? [
			"websocket",
			"sse",
		];

		// Import dynamic dependencies
		this.#dynamicImportsPromise = (async () => {
			const WebSocket = await importWebSocket();
			const EventSource = await importEventSource();
			return { WebSocket, EventSource };
		})();
	}

	/**
	 * Gets an actor by its ID.
	 * @template AD The actor class that this handle is connected to.
	 * @param {string} actorId - The ID of the actor.
	 * @param {GetWithIdOptions} [opts] - Options for getting the actor.
	 * @returns {Promise<ActorHandle<AD>>} - A promise resolving to the actor handle.
	 */
	async getWithId<AD extends AnyActorDefinition>(
		actorId: string,
		opts?: GetWithIdOptions,
	): Promise<ActorHandle<AD>> {
		logger().debug("get actor with id ", {
			actorId,
			params: opts?.params,
		});

		const resJson = await this.#sendManagerRequest<
			ActorsRequest,
			ActorsResponse
		>("POST", "/manager/actors", {
			query: {
				getForId: {
					actorId,
				},
			},
		});

		const handle = await this.#createHandle(
			resJson.endpoint,
			opts?.params,
			resJson.supportedTransports,
		);
		return this.#createProxy(handle) as ActorHandle<AD>;
	}

	/**
	 * Gets an actor by its tags, creating it if necessary.
	 *
	 * @example
	 * ```
	 * const room = await client.get<ChatRoom>({
	 *   name: 'chat_room',
	 *   // Get or create the actor for the channel `random`
	 *   channel: 'random'
	 * });
	 *
	 * // This actor will have the tags: { name: 'chat_room', channel: 'random' }
	 * await room.sendMessage('Hello, world!');
	 * ```
	 *
	 * @template AD The actor class that this handle is connected to.
	 * @param {ActorTags} tags - The tags to identify the actor.
	 * @param {GetOptions} [opts] - Options for getting the actor.
	 * @returns {Promise<ActorHandle<AD>>} - A promise resolving to the actor handle.
	 * @see {@link https://rivet.gg/docs/manage#client.get}
	 */
	async get<AD extends AnyActorDefinition>(
		name: string,
		opts?: GetOptions,
	): Promise<ActorHandle<AD>> {
		let tags = opts?.tags ?? {};

		// Build create config
		let create: CreateRequest | undefined = undefined;
		if (!opts?.noCreate) {
			create = {
				name,
				// Fall back to tags defined when querying actor
				tags: opts?.create?.tags ?? tags,
				...opts?.create,
			};
		}

		logger().debug("get actor", {
			name,
			tags,
			parameters: opts?.params,
			create,
		});

		const resJson = await this.#sendManagerRequest<
			ActorsRequest,
			ActorsResponse
		>("POST", "/manager/actors", {
			query: {
				getOrCreateForTags: {
					name,
					tags,
					create,
				},
			},
		});

		const handle = await this.#createHandle(
			resJson.endpoint,
			opts?.params,
			resJson.supportedTransports,
		);
		return this.#createProxy(handle) as ActorHandle<AD>;
	}

	/**
	 * Creates a new actor with the provided tags.
	 *
	 * @example
	 * ```
	 * // Create a new document actor
	 * const doc = await client.create<MyDocument>({
	 *   create: {
	 *     tags: {
	 *       name: 'my_document',
	 *       docId: '123'
	 *     }
	 *   }
	 * });
	 *
	 * await doc.doSomething();
	 * ```
	 *
	 * @template AD The actor class that this handle is connected to.
	 * @param {CreateOptions} opts - Options for creating the actor.
	 * @returns {Promise<ActorHandle<AD>>} - A promise resolving to the actor handle.
	 * @see {@link https://rivet.gg/docs/manage#client.create}
	 */
	async create<AD extends AnyActorDefinition>(
		name: string,
		opts: CreateOptions,
	): Promise<ActorHandle<AD>> {
		// Build create config
		const create = {
			name,
			...opts.create,
		};

		// Default to the chosen region
		//if (!create.region) create.region = (await this.#regionPromise)?.id;

		logger().debug("create actor", {
			name,
			parameters: opts?.params,
			create,
		});

		const resJson = await this.#sendManagerRequest<
			ActorsRequest,
			ActorsResponse
		>("POST", "/manager/actors", {
			query: {
				create,
			},
		});

		const handle = await this.#createHandle(
			resJson.endpoint,
			opts?.params,
			resJson.supportedTransports,
		);
		return this.#createProxy(handle) as ActorHandle<AD>;
	}

	async #createHandle(
		endpoint: string,
		params: unknown,
		serverTransports: Transport[],
	): Promise<ActorHandleRaw> {
		const imports = await this.#dynamicImportsPromise;

		const handle = new ActorHandleRaw(
			this,
			endpoint,
			params,
			this.#encodingKind,
			this.#supportedTransports,
			serverTransports,
			imports,
		);
		this[ACTOR_HANDLES_SYMBOL].add(handle);
		handle[CONNECT_SYMBOL]();
		return handle;
	}

	#createProxy<AD extends AnyActorDefinition>(
		handle: ActorHandleRaw,
	): ActorHandle<AD> {
		// Stores returned RPC functions for faster calls
		const methodCache = new Map<string, ActorRPCFunction>();
		return new Proxy(handle, {
			get(target: ActorHandleRaw, prop: string | symbol, receiver: unknown) {
				// Handle built-in Symbol properties
				if (typeof prop === "symbol") {
					return Reflect.get(target, prop, receiver);
				}

				// Handle built-in Promise methods and existing properties
				if (
					prop === "then" ||
					prop === "catch" ||
					prop === "finally" ||
					prop === "constructor" ||
					prop in target
				) {
					const value = Reflect.get(target, prop, receiver);
					// Preserve method binding
					if (typeof value === "function") {
						return value.bind(target);
					}
					return value;
				}

				// Create RPC function that preserves 'this' context
				if (typeof prop === "string") {
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
				// All string properties are potentially RPC functions
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

			// Prevent property enumeration of non-existent RPC methods
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
					// Make RPC methods appear non-enumerable
					return {
						configurable: true,
						enumerable: false,
						writable: false,
						value: (...args: unknown[]) => target.action(prop, ...args),
					};
				}
				return undefined;
			},
		}) as ActorHandle<AD>;
	}

	/**
	 * Sends an HTTP request to the manager actor.
	 * @private
	 * @template Request
	 * @template Response
	 * @param {string} method - The HTTP method.
	 * @param {string} path - The path for the request.
	 * @param {Request} [body] - The request body.
	 * @returns {Promise<Response>} - A promise resolving to the response.
	 * @see {@link https://rivet.gg/docs/manage#client}
	 */
	async #sendManagerRequest<Request, Response>(
		method: string,
		path: string,
		body?: Request,
	): Promise<Response> {
		try {
			const managerEndpoint = await this.#managerEndpointPromise;
			const res = await fetch(`${managerEndpoint}${path}`, {
				method,
				headers: {
					"Content-Type": "application/json",
				},
				body: body ? JSON.stringify(body) : undefined,
			});

			if (!res.ok) {
				throw new errors.ManagerError(`${res.statusText}: ${await res.text()}`);
			}

			return res.json();
		} catch (error) {
			throw new errors.ManagerError(String(error), { cause: error });
		}
	}

	/**
	 * Fetches the region information.
	 * @private
	 * @returns {Promise<Region | undefined>} - A promise resolving to the region or undefined.
	 * @see {@link https://rivet.gg/docs/edge#Fetching-regions-via-API}
	 */
	//async #fetchRegion(): Promise<Region | undefined> {
	//	try {
	//		// Fetch the connection info from the manager
	//		const { endpoint, project, environment } =
	//			await this.#sendManagerRequest<undefined, RivetConfigResponse>(
	//				"GET",
	//				"/rivet/config",
	//			);
	//
	//		// Fetch the region
	//		//
	//		// This is fetched from the client instead of the manager so Rivet
	//		// can automatically determine the recommended region using an
	//		// anycast request made from the client
	//		const url = new URL("/regions/resolve", endpoint);
	//		if (project) url.searchParams.set("project", project);
	//		if (environment) url.searchParams.set("environment", environment);
	//		const res = await fetch(url.toString());
	//
	//		if (!res.ok) {
	//			// Add safe fallback in case we can't fetch the region
	//			logger().error(
	//				"failed to fetch region, defaulting to manager region",
	//				{
	//					status: res.statusText,
	//					body: await res.text(),
	//				},
	//			);
	//			return undefined;
	//		}
	//
	//		const { region }: { region: Region } = await res.json();
	//
	//		return region;
	//	} catch (error) {
	//		// Add safe fallback in case we can't fetch the region
	//		logger().error(
	//			"failed to fetch region, defaulting to manager region",
	//			{
	//				error,
	//			},
	//		);
	//		return undefined;
	//	}
	//}

	/**
	 * Disconnects from all actors.
	 *
	 * @returns {Promise<void>} A promise that resolves when the socket is gracefully closed.
	 */
	async dispose(): Promise<void> {
		if (this.#disposed) {
			logger().warn("client already disconnected");
			return;
		}
		this.#disposed = true;

		logger().debug("disposing client");

		const disposePromises = [];
		for (const handle of this[ACTOR_HANDLES_SYMBOL].values()) {
			disposePromises.push(handle.dispose());
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
 * @param {string | Promise<string>} managerEndpointPromise - The manager endpoint or a promise resolving to it.
 * @param {ClientOptions} [opts] - Options for configuring the client.
 * @returns {Client<A>} - A proxied client that supports the `client.myActor.get()` syntax.
 */
export function createClient<A extends ActorCoreApp<any>>(
	managerEndpointPromise: string | Promise<string>,
	opts?: ClientOptions,
): Client<A> {
	const client = new ClientRaw(managerEndpointPromise, opts);

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
					get: (
						opts?: GetOptions,
					): Promise<ActorHandle<ExtractActorsFromApp<A>[typeof prop]>> => {
						return target.get<ExtractActorsFromApp<A>[typeof prop]>(prop, opts);
					},
					create: (
						opts: CreateOptions,
					): Promise<ActorHandle<ExtractActorsFromApp<A>[typeof prop]>> => {
						return target.create<ExtractActorsFromApp<A>[typeof prop]>(
							prop,
							opts,
						);
					},
					getWithId: (
						actorId: string,
						opts?: GetWithIdOptions,
					): Promise<ActorHandle<ExtractActorsFromApp<A>[typeof prop]>> => {
						return target.getWithId<ExtractActorsFromApp<A>[typeof prop]>(
							actorId,
							opts,
						);
					},
				} as ActorAccessor<ExtractActorsFromApp<A>[typeof prop]>;
			}

			return undefined;
		},
	}) as Client<A>;
}
