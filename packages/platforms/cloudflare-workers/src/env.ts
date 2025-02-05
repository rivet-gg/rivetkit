import type { ActorHandlerInterface } from "./actor";

export interface Env {
	ACTOR_DO: DurableObjectNamespace<ActorHandlerInterface>;
	ACTOR_KV: KVNamespace;
}
