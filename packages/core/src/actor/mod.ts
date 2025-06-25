import {
	type Actions,
	type ActorConfig,
	type ActorConfigInput,
	ActorConfigSchema,
} from "./config";
import { ActorDefinition } from "./definition";

export type { ActorContext } from "./context";
export { UserError, type UserErrorOptions } from "./errors";
export type { Conn } from "./connection";
export type { ActionContext } from "./action";
export type { ActorConfig, OnConnectOptions } from "./config";
export type { Encoding } from "@/actor/protocol/serde";
export type {
	ActorDefinition,
	AnyActorDefinition,
	ActorContextOf,
	ActionContextOf,
} from "./definition";

export function actor<
	S,
	CP,
	CS,
	V,
	I,
	AD,
	DB,
	R extends Actions<S, CP, CS, V, I, AD, DB>,
>(
	input: ActorConfigInput<S, CP, CS, V, I, AD, DB, R>,
): ActorDefinition<S, CP, CS, V, I, AD, DB, R> {
	const config = ActorConfigSchema.parse(input) as ActorConfig<
		S,
		CP,
		CS,
		V,
		I,
		AD,
		DB
	>;
	return new ActorDefinition(config);
}
export type { ActorKey } from "@/manager/protocol/query";
