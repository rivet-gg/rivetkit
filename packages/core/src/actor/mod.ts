import {
	type Actions,
	type ActorConfig,
	type ActorConfigInput,
	ActorConfigSchema,
} from "./config";
import { ActorDefinition } from "./definition";

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
export type { Encoding } from "@/actor/protocol/serde";
export type {
	UniversalErrorEvent,
	UniversalEvent,
	UniversalEventSource,
	UniversalMessageEvent,
} from "@/common/eventsource-interface";
export type { UpgradeWebSocketArgs } from "@/common/inline-websocket-adapter2";
export type {
	RivetCloseEvent,
	RivetEvent,
	RivetMessageEvent,
	UniversalWebSocket,
} from "@/common/websocket-interface";
export type { ActorKey } from "@/manager/protocol/query";
export type { ActionContext } from "./action";
export type * from "./config";
export type { Conn, generateConnId, generateConnToken } from "./connection";
export type { ActorContext } from "./context";
export type {
	ActionContextOf,
	ActorContextOf,
	ActorDefinition,
	AnyActorDefinition,
} from "./definition";
export { lookupInRegistry } from "./definition";
export { UserError, type UserErrorOptions } from "./errors";
export {
	createGenericConnDrivers,
	GenericConnGlobalState,
} from "./generic-conn-driver";
export type { AnyActorInstance } from "./instance";
export {
	type ActorRouter,
	createActorRouter,
	PATH_CONNECT_WEBSOCKET,
	PATH_RAW_WEBSOCKET_PREFIX,
} from "./router";
export {
	ALLOWED_PUBLIC_HEADERS,
	handleRawWebSocketHandler,
	handleWebSocketConnect,
} from "./router-endpoints";
