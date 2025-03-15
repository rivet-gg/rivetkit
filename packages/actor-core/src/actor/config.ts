import { Connection } from "./connection";
import { RpcContext } from "./rpc";
import { z } from "zod";

/**
 * Schema for actor state configuration
 */
export const StateOptionsSchema = z.object({
	saveInterval: z.number().positive().default(10_000),
}).strict();

export type StateOptionsType = z.infer<typeof StateOptionsSchema>;

/**
 * Schema for RPC configuration
 */
export const RpcOptionsSchema = z.object({
	timeout: z.number().positive().default(60_000),
}).strict();

export type RpcOptionsType = z.infer<typeof RpcOptionsSchema>;

/**
 * Full options schema
 */
export const OptionsSchema = z.object({
	state: StateOptionsSchema.default({}),
	rpc: RpcOptionsSchema.default({}),
}).strict();

export type OptionsType = z.infer<typeof OptionsSchema>;

/**
 * Creates a schema for connection parameters with generic type
 */
export const createOnBeforeConnectOptionsSchema = <CP extends z.ZodTypeAny>(
	connectParams: CP,
) =>
	z.object({
		/**
		 * The request object associated with the connection.
		 *
		 * @experimental
		 */
		request: z.instanceof(Request).optional(),

		/**
		 * The parameters passed when a client connects to the actor.
		 */
		parameters: connectParams,
	}).strict();

/**
 * Creates a type-safe schema for RPC definitions with proper generics
 */
export const createRpcSchema = <S, CP, CS>() =>
	z.record(
		z.string(),
		z.custom<(ctx: RpcContext<S, CP, CS>, ...args: any[]) => any>(),
	);

/**
 * Creates a type-safe schema for full actor configuration
 */
export const createActorConfigSchema = <S, CP, CS>() => {
	return z.object({
		/**
		 * Called when the actor is first initialized.
		 * 
		 * Use this hook to initialize your actor's state.
		 * This is called before any other lifecycle hooks.
		 * 
		 * @returns The initial state for the actor
		 */
		onInitialize: z.custom<() => S | Promise<S>>().optional(),

		/**
		 * Called when the actor is started and ready to receive connections and RPCs.
		 * 
		 * Use this hook to initialize resources needed for the actor's operation
		 * (timers, external connections, etc.)
		 * 
		 * @returns Void or a Promise that resolves when startup is complete
		 */
		onStart: z.custom<() => void | Promise<void>>().optional(),

		/**
		 * Called when the actor's state changes.
		 * 
		 * Use this hook to react to state changes, such as updating
		 * external systems or triggering events.
		 * 
		 * @param newState The updated state
		 */
		onStateChange: z.custom<(newState: S) => void>().optional(),

		/**
		 * Called before a client connects to the actor.
		 * 
		 * Use this hook to determine if a connection should be accepted
		 * and to initialize connection-specific state.
		 * 
		 * @param opts Connection parameters including client-provided data
		 * @returns The initial connection state or a Promise that resolves to it
		 * @throws Throw an error to reject the connection
		 */
		onBeforeConnect: z
			.custom<
				(
					opts: z.infer<
						ReturnType<typeof createOnBeforeConnectOptionsSchema<z.ZodType<CP>>>
					>,
				) => CS | Promise<CS>
			>()
			.optional(),

		/**
		 * Called when a client successfully connects to the actor.
		 * 
		 * Use this hook to perform actions when a connection is established,
		 * such as sending initial data or updating the actor's state.
		 * 
		 * @param connection The connection object
		 * @returns Void or a Promise that resolves when connection handling is complete
		 */
		onConnect: z
			.custom<(connection: Connection<S, CP, CS>) => void | Promise<void>>()
			.optional(),

		/**
		 * Called when a client disconnects from the actor.
		 * 
		 * Use this hook to clean up resources associated with the connection
		 * or update the actor's state.
		 * 
		 * @param connection The connection that is being closed
		 * @returns Void or a Promise that resolves when disconnect handling is complete
		 */
		onDisconnect: z
			.custom<(connection: Connection<S, CP, CS>) => void | Promise<void>>()
			.optional(),

		/**
		 * Called before sending an RPC response to the client.
		 * 
		 * Use this hook to modify or transform the output of an RPC before it's sent
		 * to the client. This is useful for formatting responses, adding metadata,
		 * or applying transformations to the output.
		 * 
		 * @param name The name of the RPC that was called
		 * @param args The arguments that were passed to the RPC
		 * @param output The output that will be sent to the client
		 * @returns The modified output to send to the client
		 */
		onBeforeRpcResponse: z
			.custom<
				<Out>(name: string, args: unknown[], output: Out) => Out | Promise<Out>
			>()
			.optional(),

		/**
		 * Remote procedure calls exposed by this actor.
		 */
		rpcs: createRpcSchema<S, CP, CS>(),
		options: OptionsSchema.default({}),
	}).strict();
};

/**
 * Type helper for RPC schema
 */
export type Rpcs<S, CP, CS> = z.infer<
	ReturnType<typeof createRpcSchema<S, CP, CS>>
>;

/**
 * Type helper for connection parameters
 */
export type OnBeforeConnectOptions<CP> = z.infer<
	ReturnType<typeof createOnBeforeConnectOptionsSchema<z.ZodType<CP>>>
>;

// RPCs don't need to be generic since this type is used internally at this point.
export type ActorConfig<S, CP, CS> = z.infer<
	ReturnType<typeof createActorConfigSchema<S, CP, CS>>
>;

// Replace `rpcs` with generic type so we can infer RPCs elsewhere in the codebase.
export type ActorConfigInput<
	S,
	CP,
	CS,
	R extends Rpcs<S, CP, CS> = Rpcs<S, CP, CS>,
> = Omit<
	z.input<ReturnType<typeof createActorConfigSchema<S, CP, CS>>>,
	"rpcs"
> & {
	rpcs: R;
};
