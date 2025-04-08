import {
	type ActorConfigInput,
	ActorConfigSchema,
	type Actions,
	type ActorConfig,
} from "./config";
import { ActorDefinition } from "./definition";

export type { ActorContext } from "./context";
export { UserError, type UserErrorOptions } from "./errors";
export type { Conn } from "./connection";
export type { ActionContext } from "./action";
export type { ActorConfig, OnConnectOptions } from "./config";
export type { Encoding } from "@/actor/protocol/serde";
export type { ActorTags } from "@/common/utils";
export type {
	ActorDefinition,
	ActorContextOf,
	ActionContextOf,
} from "./definition";

export function actor<S, CP, CS, V, R extends Actions<S, CP, CS, V>>(
	input: ActorConfigInput<S, CP, CS, V, R>,
): ActorDefinition<S, CP, CS, V, R> {
	const config = ActorConfigSchema.parse(input) as ActorConfig<S, CP, CS, V>;
	return new ActorDefinition(config);
}
