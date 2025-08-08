import { z } from "zod";
import type { UniversalWebSocket } from "@/common/websocket-interface";
import type { ActionContext } from "./action";
import type { Conn } from "./connection";
import type { ActorContext } from "./context";
import type { AnyDatabaseProvider } from "./database";

export type InitContext = ActorContext<
	undefined,
	undefined,
	undefined,
	undefined,
	undefined,
	undefined,
	undefined
>;

export interface ActorTypes<
	TState,
	TConnParams,
	TConnState,
	TVars,
	TInput,
	TAuthData,
	TDatabase extends AnyDatabaseProvider,
> {
	state?: TState;
	connParams?: TConnParams;
	connState?: TConnState;
	vars?: TVars;
	input?: TInput;
	authData?: TAuthData;
	database?: TDatabase;
}

// This schema is used to validate the input at runtime. The generic types are defined below in `ActorConfig`.
//
// We don't use Zod generics with `z.custom` because:
// (a) there seems to be a weird bug in either Zod, tsup, or TSC that causese external packages to have different types from `z.infer` than from within the same package and
// (b) it makes the type definitions incredibly difficult to read as opposed to vanilla TypeScript.
export const ActorConfigSchema = z
	.object({
		onAuth: z.function().optional(),
		onCreate: z.function().optional(),
		onStart: z.function().optional(),
		onStateChange: z.function().optional(),
		onBeforeConnect: z.function().optional(),
		onConnect: z.function().optional(),
		onDisconnect: z.function().optional(),
		onBeforeActionResponse: z.function().optional(),
		onFetch: z.function().optional(),
		onWebSocket: z.function().optional(),
		actions: z.record(z.function()).default({}),
		state: z.any().optional(),
		createState: z.function().optional(),
		connState: z.any().optional(),
		createConnState: z.function().optional(),
		vars: z.any().optional(),
		db: z.any().optional(),
		createVars: z.function().optional(),
		options: z
			.object({
				lifecycle: z
					.object({
						createVarsTimeout: z.number().positive().default(5000),
						createConnStateTimeout: z.number().positive().default(5000),
						onConnectTimeout: z.number().positive().default(5000),
					})
					.strict()
					.default({}),
				state: z
					.object({
						saveInterval: z.number().positive().default(10_000),
					})
					.strict()
					.default({}),
				action: z
					.object({
						timeout: z.number().positive().default(60_000),
					})
					.strict()
					.default({}),
			})
			.strict()
			.default({}),
	})
	.strict()
	.refine(
		(data) => !(data.state !== undefined && data.createState !== undefined),
		{
			message: "Cannot define both 'state' and 'createState'",
			path: ["state"],
		},
	)
	.refine(
		(data) =>
			!(data.connState !== undefined && data.createConnState !== undefined),
		{
			message: "Cannot define both 'connState' and 'createConnState'",
			path: ["connState"],
		},
	)
	.refine(
		(data) => !(data.vars !== undefined && data.createVars !== undefined),
		{
			message: "Cannot define both 'vars' and 'createVars'",
			path: ["vars"],
		},
	);

export interface OnConnectOptions {
	/**
	 * The request object associated with the connection.
	 *
	 * @experimental
	 */
	request?: Request;
}

// Creates state config
//
// This must have only one or the other or else TState will not be able to be inferred
//
// Data returned from this handler will be available on `c.state`.
type CreateState<
	TState,
	TConnParams,
	TConnState,
	TVars,
	TInput,
	TAuthData,
	TDatabase,
> =
	| { state: TState }
	| {
			createState: (c: InitContext, input: TInput) => TState | Promise<TState>;
	  }
	| Record<never, never>;

// Creates connection state config
//
// This must have only one or the other or else TState will not be able to be inferred
//
// Data returned from this handler will be available on `c.conn.state`.
type CreateConnState<
	TState,
	TConnParams,
	TConnState,
	TVars,
	TInput,
	TAuthData,
	TDatabase,
> =
	| { connState: TConnState }
	| {
			createConnState: (
				c: InitContext,
				params: TConnParams,
				opts: OnConnectOptions,
			) => TConnState | Promise<TConnState>;
	  }
	| Record<never, never>;

// Creates vars config
//
// This must have only one or the other or else TState will not be able to be inferred
/**
 * @experimental
 */
type CreateVars<
	TState,
	TConnParams,
	TConnState,
	TVars,
	TInput,
	TAuthData,
	TDatabase,
> =
	| {
			/**
			 * @experimental
			 */
			vars: TVars;
	  }
	| {
			/**
			 * @experimental
			 */
			createVars: (c: InitContext, driverCtx: any) => TVars | Promise<TVars>;
	  }
	| Record<never, never>;

// Creates auth config
//
// This must have only one or the other or else TAuthData will not be able to be inferred
type OnAuth<TConnParams, TAuthData> =
	| {
			/**
			 * Called on the HTTP server before clients can interact with the actor.
			 *
			 * Only called for public endpoints. Calls to actors from within the backend
			 * do not trigger this handler.
			 *
			 * Data returned from this handler will be available on `c.conn.auth`.
			 *
			 * This function is required for any public HTTP endpoint access. Use this hook
			 * to validate client credentials and return authentication data that will be
			 * available on connections. This runs on the HTTP server (not the actor)
			 * in order to reduce load on the actor & prevent denial of server attacks
			 * against individual actors.
			 *
			 * If you need access to actor state for authentication, use onBeforeConnect
			 * with an empty onAuth function instead.
			 *
			 * You can also provide your own authentication middleware on your router if you
			 * choose, then use onAuth to pass the authentication data (e.g. user ID) to the
			 * actor itself.
			 *
			 * @param opts Authentication options including request and intent
			 * @returns Authentication data to attach to connections (must be serializable)
			 * @throws Throw an error to deny access to the actor
			 */
			onAuth: (
				params: TConnParams,
				opts: OnAuthOptions,
			) => TAuthData | Promise<TAuthData>;
	  }
	| Record<never, never>;

export interface Actions<
	TState,
	TConnParams,
	TConnState,
	TVars,
	TInput,
	TAuthData,
	TDatabase extends AnyDatabaseProvider,
> {
	[Action: string]: (
		c: ActionContext<
			TState,
			TConnParams,
			TConnState,
			TVars,
			TInput,
			TAuthData,
			TDatabase
		>,
		...args: any[]
	) => any;
}

//export type ActorConfig<TState, TConnParams, TConnState, TVars, TInput, TAuthData> = BaseActorConfig<TState, TConnParams, TConnState, TVars, TInput, TAuthData> &
//	ActorConfigLifecycle<TState, TConnParams, TConnState, TVars, TInput, TAuthData> &
//	CreateState<TState, TConnParams, TConnState, TVars, TInput, TAuthData> &
//	CreateConnState<TState, TConnParams, TConnState, TVars, TInput, TAuthData>;

/**
 * @experimental
 */
export type AuthIntent = "get" | "create" | "connect" | "action" | "message";

export interface OnAuthOptions {
	request: Request;
	/**
	 * @experimental
	 */
	intents: Set<AuthIntent>;
}

interface BaseActorConfig<
	TState,
	TConnParams,
	TConnState,
	TVars,
	TInput,
	TAuthData,
	TDatabase extends AnyDatabaseProvider,
	TActions extends Actions<
		TState,
		TConnParams,
		TConnState,
		TVars,
		TInput,
		TAuthData,
		TDatabase
	>,
> {
	/**
	 * Called when the actor is first initialized.
	 *
	 * Use this hook to initialize your actor's state.
	 * This is called before any other lifecycle hooks.
	 */
	onCreate?: (
		c: ActorContext<
			TState,
			TConnParams,
			TConnState,
			TVars,
			TInput,
			TAuthData,
			TDatabase
		>,
		input: TInput,
	) => void | Promise<void>;

	/**
	 * Called when the actor is started and ready to receive connections and action.
	 *
	 * Use this hook to initialize resources needed for the actor's operation
	 * (timers, external connections, etc.)
	 *
	 * @returns Void or a Promise that resolves when startup is complete
	 */
	onStart?: (
		c: ActorContext<
			TState,
			TConnParams,
			TConnState,
			TVars,
			TInput,
			TAuthData,
			TDatabase
		>,
	) => void | Promise<void>;

	/**
	 * Called when the actor's state changes.
	 *
	 * Use this hook to react to state changes, such as updating
	 * external systems or triggering events.
	 *
	 * @param newState The updated state
	 */
	onStateChange?: (
		c: ActorContext<
			TState,
			TConnParams,
			TConnState,
			TVars,
			TInput,
			TAuthData,
			TDatabase
		>,
		newState: TState,
	) => void;

	/**
	 * Called before a client connects to the actor.
	 *
	 * Unlike onAuth, this handler is still called for both internal and
	 * public clients.
	 *
	 * Use this hook to determine if a connection should be accepted
	 * and to initialize connection-specific state. Unlike onAuth, this runs
	 * on the actor and has access to actor state, but uses slightly
	 * more resources on the actor rather than authenticating with onAuth.
	 *
	 * For authentication without actor state access, prefer onAuth.
	 *
	 * For authentication with actor state, use onBeforeConnect with an empty
	 * onAuth handler.
	 *
	 * @param opts Connection parameters including client-provided data
	 * @returns The initial connection state or a Promise that resolves to it
	 * @throws Throw an error to reject the connection
	 */
	onBeforeConnect?: (
		c: ActorContext<
			TState,
			TConnParams,
			TConnState,
			TVars,
			TInput,
			TAuthData,
			TDatabase
		>,
		params: TConnParams,
		opts: OnConnectOptions,
	) => void | Promise<void>;

	/**
	 * Called when a client successfully connects to the actor.
	 *
	 * Use this hook to perform actions when a connection is established,
	 * such as sending initial data or updating the actor's state.
	 *
	 * @param conn The connection object
	 * @returns Void or a Promise that resolves when connection handling is complete
	 */
	onConnect?: (
		c: ActorContext<
			TState,
			TConnParams,
			TConnState,
			TVars,
			TInput,
			TAuthData,
			TDatabase
		>,
		conn: Conn<
			TState,
			TConnParams,
			TConnState,
			TVars,
			TInput,
			TAuthData,
			TDatabase
		>,
	) => void | Promise<void>;

	/**
	 * Called when a client disconnects from the actor.
	 *
	 * Use this hook to clean up resources associated with the connection
	 * or update the actor's state.
	 *
	 * @param conn The connection that is being closed
	 * @returns Void or a Promise that resolves when disconnect handling is complete
	 */
	onDisconnect?: (
		c: ActorContext<
			TState,
			TConnParams,
			TConnState,
			TVars,
			TInput,
			TAuthData,
			TDatabase
		>,
		conn: Conn<
			TState,
			TConnParams,
			TConnState,
			TVars,
			TInput,
			TAuthData,
			TDatabase
		>,
	) => void | Promise<void>;

	/**
	 * Called before sending an action response to the client.
	 *
	 * Use this hook to modify or transform the output of an action before it's sent
	 * to the client. This is useful for formatting responses, adding metadata,
	 * or applying transformations to the output.
	 *
	 * @param name The name of the action that was called
	 * @param args The arguments that were passed to the action
	 * @param output The output that will be sent to the client
	 * @returns The modified output to send to the client
	 */
	onBeforeActionResponse?: <Out>(
		c: ActorContext<
			TState,
			TConnParams,
			TConnState,
			TVars,
			TInput,
			TAuthData,
			TDatabase
		>,
		name: string,
		args: unknown[],
		output: Out,
	) => Out | Promise<Out>;

	/**
	 * Called when a raw HTTP request is made to the actor.
	 *
	 * This handler receives raw HTTP requests made to `/actors/{actorName}/http/*` endpoints.
	 * Use this hook to handle custom HTTP patterns, REST APIs, or other HTTP-based protocols.
	 *
	 * @param request The raw HTTP request object
	 * @returns A Response object to send back, or void to continue with default routing
	 */
	onFetch?: (
		c: ActorContext<
			TState,
			TConnParams,
			TConnState,
			TVars,
			TInput,
			TAuthData,
			TDatabase
		>,
		request: Request,
		opts: { auth: TAuthData },
	) => Response | Promise<Response>;

	/**
	 * Called when a raw WebSocket connection is established to the actor.
	 *
	 * This handler receives WebSocket connections made to `/actors/{actorName}/websocket/*` endpoints.
	 * Use this hook to handle custom WebSocket protocols, binary streams, or other WebSocket-based communication.
	 *
	 * @param websocket The raw WebSocket connection
	 * @param request The original HTTP upgrade request
	 */
	onWebSocket?: (
		c: ActorContext<
			TState,
			TConnParams,
			TConnState,
			TVars,
			TInput,
			TAuthData,
			TDatabase
		>,
		websocket: UniversalWebSocket,
		opts: { request: Request; auth: TAuthData },
	) => void | Promise<void>;

	actions: TActions;
}

type ActorDatabaseConfig<TDatabase extends AnyDatabaseProvider> =
	| {
			/**
			 * @experimental
			 */
			db: TDatabase;
	  }
	| Record<never, never>;

// 1. Infer schema
// 2. Omit keys that we'll manually define (because of generics)
// 3. Define our own types that have generic constraints
export type ActorConfig<
	TState,
	TConnParams,
	TConnState,
	TVars,
	TInput,
	TAuthData,
	TDatabase extends AnyDatabaseProvider,
> = Omit<
	z.infer<typeof ActorConfigSchema>,
	| "actions"
	| "onAuth"
	| "onCreate"
	| "onStart"
	| "onStateChange"
	| "onBeforeConnect"
	| "onConnect"
	| "onDisconnect"
	| "onBeforeActionResponse"
	| "onFetch"
	| "onWebSocket"
	| "state"
	| "createState"
	| "connState"
	| "createConnState"
	| "vars"
	| "createVars"
	| "db"
> &
	BaseActorConfig<
		TState,
		TConnParams,
		TConnState,
		TVars,
		TInput,
		TAuthData,
		TDatabase,
		Actions<
			TState,
			TConnParams,
			TConnState,
			TVars,
			TInput,
			TAuthData,
			TDatabase
		>
	> &
	OnAuth<TConnParams, TAuthData> &
	CreateState<
		TState,
		TConnParams,
		TConnState,
		TVars,
		TInput,
		TAuthData,
		TDatabase
	> &
	CreateConnState<
		TState,
		TConnParams,
		TConnState,
		TVars,
		TInput,
		TAuthData,
		TDatabase
	> &
	CreateVars<
		TState,
		TConnParams,
		TConnState,
		TVars,
		TInput,
		TAuthData,
		TDatabase
	> &
	ActorDatabaseConfig<TDatabase>;

// See description on `ActorConfig`
export type ActorConfigInput<
	TState = undefined,
	TConnParams = undefined,
	TConnState = undefined,
	TVars = undefined,
	TInput = undefined,
	TAuthData = undefined,
	TDatabase extends AnyDatabaseProvider = undefined,
	TActions extends Actions<
		TState,
		TConnParams,
		TConnState,
		TVars,
		TInput,
		TAuthData,
		TDatabase
	> = Record<never, never>,
> = {
	types?: ActorTypes<
		TState,
		TConnParams,
		TConnState,
		TVars,
		TInput,
		TAuthData,
		TDatabase
	>;
} & Omit<
	z.input<typeof ActorConfigSchema>,
	| "actions"
	| "onAuth"
	| "onCreate"
	| "onStart"
	| "onStateChange"
	| "onBeforeConnect"
	| "onConnect"
	| "onDisconnect"
	| "onBeforeActionResponse"
	| "onFetch"
	| "onWebSocket"
	| "state"
	| "createState"
	| "connState"
	| "createConnState"
	| "vars"
	| "createVars"
	| "db"
> &
	BaseActorConfig<
		TState,
		TConnParams,
		TConnState,
		TVars,
		TInput,
		TAuthData,
		TDatabase,
		TActions
	> &
	OnAuth<TConnParams, TAuthData> &
	CreateState<
		TState,
		TConnParams,
		TConnState,
		TVars,
		TInput,
		TAuthData,
		TDatabase
	> &
	CreateConnState<
		TState,
		TConnParams,
		TConnState,
		TVars,
		TInput,
		TAuthData,
		TDatabase
	> &
	CreateVars<
		TState,
		TConnParams,
		TConnState,
		TVars,
		TInput,
		TAuthData,
		TDatabase
	> &
	ActorDatabaseConfig<TDatabase>;

// For testing type definitions:
export function test<
	TState,
	TConnParams,
	TConnState,
	TVars,
	TInput,
	TAuthData,
	TDatabase extends AnyDatabaseProvider,
	TActions extends Actions<
		TState,
		TConnParams,
		TConnState,
		TVars,
		TInput,
		TAuthData,
		TDatabase
	>,
>(
	input: ActorConfigInput<
		TState,
		TConnParams,
		TConnState,
		TVars,
		TInput,
		TAuthData,
		TDatabase,
		TActions
	>,
): ActorConfig<
	TState,
	TConnParams,
	TConnState,
	TVars,
	TInput,
	TAuthData,
	TDatabase
> {
	const config = ActorConfigSchema.parse(input) as ActorConfig<
		TState,
		TConnParams,
		TConnState,
		TVars,
		TInput,
		TAuthData,
		TDatabase
	>;
	return config;
}
