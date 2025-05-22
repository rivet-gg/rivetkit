import { ActorDriver, AnyActorInstance } from "actor-core/driver-helpers";
import invariant from "invariant";
import { KEYS } from "./actor-handler-do";

interface DurableObjectGlobalState {
	ctx: DurableObjectState;
	env: unknown;
}

/**
 * Cloudflare DO can have multiple DO running within the same global scope.
 *
 * This allows for storing the actor context globally and looking it up by ID in `CloudflareWorkersActorDriver`.
 */
export class CloudflareDurableObjectGlobalState {
	// Single map for all actor state
	#dos: Map<string, DurableObjectGlobalState> = new Map();

	getDOState(actorId: string): DurableObjectGlobalState {
		const state = this.#dos.get(actorId);
		invariant(state !== undefined, "durable object state not in global state");
		return state;
	}

	setDOState(actorId: string, state: DurableObjectGlobalState) {
		this.#dos.set(actorId, state);
	}
}

export interface ActorDriverContext {
	ctx: DurableObjectState;
	env: unknown;
}

export class CloudflareWorkersActorDriver implements ActorDriver {
	#globalState: CloudflareDurableObjectGlobalState;

	constructor(globalState: CloudflareDurableObjectGlobalState) {
		this.#globalState = globalState;
	}

	#getDOCtx(actorId: string) {
		return this.#globalState.getDOState(actorId).ctx;
	}

	getContext(actorId: string): ActorDriverContext {
		const state = this.#globalState.getDOState(actorId);
		return { ctx: state.ctx, env: state.env };
	}

	async readInput(actorId: string): Promise<unknown | undefined> {
		return await this.#getDOCtx(actorId).storage.get(KEYS.INPUT);
	}

	async readPersistedData(actorId: string): Promise<unknown | undefined> {
		return await this.#getDOCtx(actorId).storage.get(KEYS.PERSISTED_DATA);
	}

	async writePersistedData(actorId: string, data: unknown): Promise<void> {
		await this.#getDOCtx(actorId).storage.put(KEYS.PERSISTED_DATA, data);
	}

	async setAlarm(actor: AnyActorInstance, timestamp: number): Promise<void> {
		await this.#getDOCtx(actor.id).storage.setAlarm(timestamp);
	}
}
