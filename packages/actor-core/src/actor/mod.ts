import { ActorConfigInput, createActorConfigSchema, Actions } from "./config";
import { ActorDefinition } from "./definition";

export type { ActorContext } from "./context";
export { UserError, type UserErrorOptions } from "./errors";
export type { Connection } from "./connection";
export type { ActionContext } from "./action";
export type { ActorConfig, OnBeforeConnectOptions } from "./config";
export type { Encoding } from "@/actor/protocol/serde";
export type { ActorTags } from "@/common/utils";
export type { ActorDefinition } from "./definition";

export function actor<
	S = undefined,
	CP = undefined,
	CS = undefined,
	R extends Actions<S, CP, CS> = {},
>(input: ActorConfigInput<S, CP, CS, R>): ActorDefinition<R, S, CP, CS> {
	const config = createActorConfigSchema<S, CP, CS>().parse(input);
	return new ActorDefinition(config);
}
