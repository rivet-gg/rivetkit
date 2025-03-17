import { Connection } from "./connection";
import { ActionContext } from "./action";
import { z } from "zod";
import { ActorContext } from "./context";

/**
 * Schema for actor state configuration
 */
export const StateOptionsSchema = z
	.object({
		saveInterval: z.number().positive().default(10_000),
	})
	.strict();

export type StateOptionsType = z.infer<typeof StateOptionsSchema>;

/**
 * Schema for action configuration
 */
export const ActionOptionsSchema = z
	.object({
		timeout: z.number().positive().default(60_000),
	})
	.strict();

export type ActionOptionsType = z.infer<typeof ActionOptionsSchema>;

/**
 * Full options schema
 */
export const OptionsSchema = z
	.object({
		state: StateOptionsSchema.default({}),
		action: ActionOptionsSchema.default({}),
	})
	.strict();

export type OptionsType = z.infer<typeof OptionsSchema>;

/**
 * Creates a schema for connection parameters with generic type
 */
export const createOnBeforeConnectOptionsSchema = <CP extends z.ZodTypeAny>(
	connectParams: CP,
) =>
	z
		.object({
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
		})
		.strict();

/**
 * Creates a type-safe schema for action definitions with proper generics
 */
export const createActionSchema = <S, CP, CS>() =>
	z.record(
		z.string(),
		z.custom<(c: ActionContext<S, CP, CS>, ...args: any[]) => any>(),
	);

// Creates state config
//
// This must have only one or the other or else S will not be able to be inferred
export const createStateSchema = <S, CP, CS>() =>
	z.union([
		z.object({ state: z.custom<S>() }).strict(),
		z
			.object({
				createState:
					z.custom<(c: ActorContext<undefined, CP, CS>) => S | Promise<S>>(),
			})
			.strict(),
		z.object({}).strict(),
	]);

// Creates connection state config
//
// This must have only one or the other or else S will not be able to be inferred
export const createConnectionStateSchema = <S, CP, CS>() =>
	z.union([
		z.object({ connectionState: z.custom<CS>() }).strict(),
		z
			.object({
				createConnectionState:
					z.custom<
						(
							c: ActorContext<S, CP, CS>,
							opts: z.infer<
								ReturnType<
									typeof createOnBeforeConnectOptionsSchema<z.ZodType<CP>>
								>
							>,
						) => CS | Promise<CS>
					>(),
			})
			.strict(),
		z.object({}).strict(),
	]);

/**
 * Creates a type-safe schema for full actor configuration
 */
export const createActorConfigSchema = <
	S,
	CP = undefined,
	CS = undefined,
>() => {
	return z
		.object({
			/**
			 * Called when the actor is first initialized.
			 *
			 * Use this hook to initialize your actor's state.
			 * This is called before any other lifecycle hooks.
			 */
			onCreate: z
				.custom<(c: ActorContext<S, CP, CS>) => void | Promise<void>>()
				.optional(),

			/**
			 * Called when the actor is started and ready to receive connections and action.
			 *
			 * Use this hook to initialize resources needed for the actor's operation
			 * (timers, external connections, etc.)
			 *
			 * @returns Void or a Promise that resolves when startup is complete
			 */
			onStart: z
				.custom<(c: ActorContext<S, CP, CS>) => void | Promise<void>>()
				.optional(),

			/**
			 * Called when the actor's state changes.
			 *
			 * Use this hook to react to state changes, such as updating
			 * external systems or triggering events.
			 *
			 * @param newState The updated state
			 */
			onStateChange: z
				.custom<(c: ActorContext<S, CP, CS>, newState: S) => void>()
				.optional(),

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
						c: ActorContext<S, CP, CS>,
						opts: z.infer<
							ReturnType<
								typeof createOnBeforeConnectOptionsSchema<z.ZodType<CP>>
							>
						>,
					) => void | Promise<void>
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
				.custom<
					(
						c: ActorContext<S, CP, CS>,
						connection: Connection<S, CP, CS>,
					) => void | Promise<void>
				>()
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
				.custom<
					(
						c: ActorContext<S, CP, CS>,
						connection: Connection<S, CP, CS>,
					) => void | Promise<void>
				>()
				.optional(),

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
			onBeforeActionResponse: z
				.custom<
					<Out>(
						c: ActorContext<S, CP, CS>,
						name: string,
						args: unknown[],
						output: Out,
					) => Out | Promise<Out>
				>()
				.optional(),

			/**
			 * Remote procedure calls exposed by this actor.
			 */
			actions: createActionSchema<S, CP, CS>(),
			options: OptionsSchema.default({}),
		})
		.strict()
		.and(createStateSchema<S, CP, CS>())
		.and(createConnectionStateSchema<S, CP, CS>());
};

/**
 * Type helper for action schema
 */
export type Actions<S, CP, CS> = z.infer<
	ReturnType<typeof createActionSchema<S, CP, CS>>
>;

/**
 * Type helper for connection parameters
 */
export type OnBeforeConnectOptions<CP> = z.infer<
	ReturnType<typeof createOnBeforeConnectOptionsSchema<z.ZodType<CP>>>
>;

// Actions don't need to be generic since this type is used internally at this point.
export type ActorConfig<S, CP, CS> = z.infer<
	ReturnType<typeof createActorConfigSchema<S, CP, CS>>
>;

// Replace `Actions` with generic type so we can infer Action elsewhere in the codebase.
//
// `state`, `createState`, and other complex types must be excluded because you cannot do `Omit<A & (B | C), "foo">`. It only works as `Omit<A, "foo"> & (B | C)`
export type ActorConfigInput<
	S,
	CP,
	CS,
	R extends Actions<S, CP, CS> = Actions<S, CP, CS>,
> = Omit<
	z.input<ReturnType<typeof createActorConfigSchema<S, CP, CS>>>,
	| "actions"
	| "state"
	| "createState"
	| "connectionState"
	| "createConnectionState"
> &
	z.input<ReturnType<typeof createStateSchema<S, CP, CS>>> &
	z.input<ReturnType<typeof createConnectionStateSchema<S, CP, CS>>> & {
		actions: R;
	};

// For testing type definitions:
//export function test<
//	R extends Actions<S, CP, CS>,
//	S,
//	CP = undefined,
//	CS = undefined,
//>(input: ActorConfigInput<S, CP, CS, R>): ActorConfig<S, CP, CS> {
//	return createActorConfigSchema<S, CP, CS>().parse(input);
//}
//
//const x = test({
//	state: { count: 0 },
//	actions: {
//		increment: (c, x: number) => {
//			c.state.count += x;
//			c.broadcast("newCount", c.state.count);
//			return c.state.count;
//		},
//	},
//});
