import { ActorConfigInput, createActorConfigSchema, Rpcs } from "./config";
import { ActorDefinition } from "./definition";

export type { ActorContext } from "./context";
export { UserError, type UserErrorOptions } from "./errors";
export type { Connection } from "./connection";
export type { RpcContext } from "./rpc";
export type { ActorConfig, OnBeforeConnectOptions } from "./config";
export type { Encoding } from "@/actor/protocol/serde";
export type { ActorTags } from "@/common/utils";
export type { ActorDefinition } from "./definition";

export function actor<
	R extends Rpcs<S, CP, CS>,
	S = undefined,
	CP = undefined,
	CS = undefined,
>(input: ActorConfigInput<S, CP, CS, R>): ActorDefinition<R, S, CP, CS> {
	const config = createActorConfigSchema<S, CP, CS>().parse(input);
	return new ActorDefinition(config);
}
