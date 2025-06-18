import type { Conn } from "./connection";
import type { ActionContext } from "./action";
import type { WorkerContext } from "./context";
import { z } from "zod";

// This schema is used to validate the input at runtime. The generic types are defined below in `WorkerConfig`.
//
// We don't use Zod generics with `z.custom` because:
// (a) there seems to be a weird bug in either Zod, tsup, or TSC that causese external packages to have different types from `z.infer` than from within the same package and
// (b) it makes the type definitions incredibly difficult to read as opposed to vanilla TypeScript.
export const WorkerConfigSchema = z
	.object({
		onAuth: z.function().optional(),
		onCreate: z.function().optional(),
		onStart: z.function().optional(),
		onStateChange: z.function().optional(),
		onBeforeConnect: z.function().optional(),
		onConnect: z.function().optional(),
		onDisconnect: z.function().optional(),
		onBeforeActionResponse: z.function().optional(),
		actions: z.record(z.function()),
		state: z.any().optional(),
		createState: z.function().optional(),
		connState: z.any().optional(),
		createConnState: z.function().optional(),
		vars: z.any().optional(),
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

export interface OnCreateOptions {
	input?: unknown;
}

export interface CreateStateOptions {
	input?: unknown;
}

export interface OnConnectOptions<CP> {
	/**
	 * The request object associated with the connection.
	 *
	 * @experimental
	 */
	request?: Request;
	params: CP;
}

// Creates state config
//
// This must have only one or the other or else S will not be able to be inferred
//
// Data returned from this handler will be available on `c.state`.
type CreateState<S, CP, CS, V> =
	| { state: S }
	| {
			createState: (
				c: WorkerContext<undefined, undefined, undefined, undefined>,
				opts: CreateStateOptions,
			) => S | Promise<S>;
	  }
	| Record<never, never>;

// Creates connection state config
//
// This must have only one or the other or else S will not be able to be inferred
//
// Data returned from this handler will be available on `c.conn.state`.
type CreateConnState<S, CP, CS, V> =
	| { connState: CS }
	| {
			createConnState: (
				c: WorkerContext<undefined, undefined, undefined, undefined>,
				opts: OnConnectOptions<CP>,
			) => CS | Promise<CS>;
	  }
	| Record<never, never>;

// Creates vars config
//
// This must have only one or the other or else S will not be able to be inferred
/**
 * @experimental
 */
type CreateVars<S, CP, CS, V> =
	| {
			/**
			 * @experimental
			 */
			vars: V;
	  }
	| {
			/**
			 * @experimental
			 */
			createVars: (
				c: WorkerContext<undefined, undefined, undefined, undefined>,
				driverCtx: unknown,
			) => V | Promise<V>;
	  }
	| Record<never, never>;

export interface Actions<S, CP, CS, V> {
	[Action: string]: (c: ActionContext<S, CP, CS, V>, ...args: any[]) => any;
}

//export type WorkerConfig<S, CP, CS, V> = BaseWorkerConfig<S, CP, CS, V> &
//	WorkerConfigLifecycle<S, CP, CS, V> &
//	CreateState<S, CP, CS, V> &
//	CreateConnState<S, CP, CS, V>;

/**
 * @experimental
 */
export type AuthIntent = "get" | "create" | "connect" | "action" | "message";

interface OnAuthOptions<CP> {
	req: Request;
	/**
	 * @experimental
	 */
	intents: Set<AuthIntent>;
	params: CP;
}

interface BaseWorkerConfig<S, CP, CS, V, R extends Actions<S, CP, CS, V>> {
	/**
	 * Called on the HTTP server before clients can interact with the worker.
	 *
	 * Only called for public endpoints. Calls to workers from within the backend
	 * do not trigger this handler.
	 *
	 * Data returned from this handler will be available on `c.conn.auth`.
	 *
	 * This function is required for any public HTTP endpoint access. Use this hook
	 * to validate client credentials and return authentication data that will be
	 * available on connections. This runs on the HTTP server (not the worker)
	 * in order to reduce load on the worker & prevent denial of server attacks
	 * against individual workers.
	 *
	 * If you need access to worker state for authentication, use onBeforeConnect
	 * with an empty onAuth function instead.
	 *
	 * You can also provide your own authentication middleware on your router if you
	 * choose, then use onAuth to pass the authentication data (e.g. user ID) to the
	 * worker itself.
	 *
	 * @param opts Authentication options including request and intent
	 * @returns Authentication data to attach to connections (must be serializable)
	 * @throws Throw an error to deny access to the worker
	 */
	onAuth?: (opts: OnAuthOptions<CP>) => unknown | Promise<unknown>;

	/**
	 * Called when the worker is first initialized.
	 *
	 * Use this hook to initialize your worker's state.
	 * This is called before any other lifecycle hooks.
	 */
	onCreate?: (
		c: WorkerContext<S, CP, CS, V>,
		opts: OnCreateOptions,
	) => void | Promise<void>;

	/**
	 * Called when the worker is started and ready to receive connections and action.
	 *
	 * Use this hook to initialize resources needed for the worker's operation
	 * (timers, external connections, etc.)
	 *
	 * @returns Void or a Promise that resolves when startup is complete
	 */
	onStart?: (c: WorkerContext<S, CP, CS, V>) => void | Promise<void>;

	/**
	 * Called when the worker's state changes.
	 *
	 * Use this hook to react to state changes, such as updating
	 * external systems or triggering events.
	 *
	 * @param newState The updated state
	 */
	onStateChange?: (c: WorkerContext<S, CP, CS, V>, newState: S) => void;

	/**
	 * Called before a client connects to the worker.
	 *
	 * Unlike onAuth, this handler is still called for both internal and
	 * public clients.
	 *
	 * Use this hook to determine if a connection should be accepted
	 * and to initialize connection-specific state. Unlike onAuth, this runs
	 * on the worker and has access to worker state, but uses slightly
	 * more resources on the worker rather than authenticating with onAuth.
	 *
	 * For authentication without worker state access, prefer onAuth.
	 *
	 * For authentication with worker state, use onBeforeConnect with an empty
	 * onAuth handler.
	 *
	 * @param opts Connection parameters including client-provided data
	 * @returns The initial connection state or a Promise that resolves to it
	 * @throws Throw an error to reject the connection
	 */
	onBeforeConnect?: (
		c: WorkerContext<S, CP, CS, V>,
		opts: OnConnectOptions<CP>,
	) => void | Promise<void>;

	/**
	 * Called when a client successfully connects to the worker.
	 *
	 * Use this hook to perform actions when a connection is established,
	 * such as sending initial data or updating the worker's state.
	 *
	 * @param conn The connection object
	 * @returns Void or a Promise that resolves when connection handling is complete
	 */
	onConnect?: (
		c: WorkerContext<S, CP, CS, V>,
		conn: Conn<S, CP, CS, V>,
	) => void | Promise<void>;

	/**
	 * Called when a client disconnects from the worker.
	 *
	 * Use this hook to clean up resources associated with the connection
	 * or update the worker's state.
	 *
	 * @param conn The connection that is being closed
	 * @returns Void or a Promise that resolves when disconnect handling is complete
	 */
	onDisconnect?: (
		c: WorkerContext<S, CP, CS, V>,
		conn: Conn<S, CP, CS, V>,
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
		c: WorkerContext<S, CP, CS, V>,
		name: string,
		args: unknown[],
		output: Out,
	) => Out | Promise<Out>;

	actions: R;
}

// 1. Infer schema
// 2. Omit keys that we'll manually define (because of generics)
// 3. Define our own types that have generic constraints
export type WorkerConfig<S, CP, CS, V> = Omit<
	z.infer<typeof WorkerConfigSchema>,
	| "actions"
	| "onAuth"
	| "onCreate"
	| "onStart"
	| "onStateChange"
	| "onBeforeConnect"
	| "onConnect"
	| "onDisconnect"
	| "onBeforeActionResponse"
	| "state"
	| "createState"
	| "connState"
	| "createConnState"
	| "vars"
	| "createVars"
> &
	BaseWorkerConfig<S, CP, CS, V, Actions<S, CP, CS, V>> &
	CreateState<S, CP, CS, V> &
	CreateConnState<S, CP, CS, V> &
	CreateVars<S, CP, CS, V>;

// See description on `WorkerConfig`
export type WorkerConfigInput<
	S,
	CP,
	CS,
	V,
	R extends Actions<S, CP, CS, V>,
> = Omit<
	z.input<typeof WorkerConfigSchema>,
	| "actions"
	| "onAuth"
	| "onCreate"
	| "onStart"
	| "onStateChange"
	| "onBeforeConnect"
	| "onConnect"
	| "onDisconnect"
	| "onBeforeActionResponse"
	| "state"
	| "createState"
	| "connState"
	| "createConnState"
	| "vars"
	| "createVars"
> &
	BaseWorkerConfig<S, CP, CS, V, R> &
	CreateState<S, CP, CS, V> &
	CreateConnState<S, CP, CS, V> &
	CreateVars<S, CP, CS, V>;

// For testing type definitions:
export function test<S, CP, CS, V, R extends Actions<S, CP, CS, V>>(
	input: WorkerConfigInput<S, CP, CS, V, R>,
): WorkerConfig<S, CP, CS, V> {
	const config = WorkerConfigSchema.parse(input) as WorkerConfig<S, CP, CS, V>;
	return config;
}

export const testWorker = test({
	state: { count: 0 },
	// createState: () => ({ count: 0 }),
	actions: {
		increment: (c, x: number) => {
			c.state.count += x;
			c.broadcast("newCount", c.state.count);
			return c.state.count;
		},
	},
});
