import {
	ActorDriver,
	KvKey,
	KvValue,
	AnyActorInstance,
} from "actor-core/driver-helpers";
import invariant from "invariant";

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

	async kvGet(actorId: string, key: KvKey): Promise<KvValue | undefined> {
		return await this.#getDOCtx(actorId).storage.get(this.#serializeKey(key));
	}

	async kvGetBatch(
		actorId: string,
		keys: KvKey[],
	): Promise<(KvValue | undefined)[]> {
		const resultMap = await this.#getDOCtx(actorId).storage.get(
			keys.map(this.#serializeKey),
		);
		return keys.map((key) => resultMap.get(this.#serializeKey(key)));
	}

	async kvPut(actorId: string, key: KvKey, value: KvValue): Promise<void> {
		await this.#getDOCtx(actorId).storage.put(this.#serializeKey(key), value);
	}

	async kvPutBatch(
		actorId: string,
		entries: [KvKey, KvValue][],
	): Promise<void> {
		await this.#getDOCtx(actorId).storage.put(
			Object.fromEntries(entries.map(([k, v]) => [this.#serializeKey(k), v])),
		);
	}

	async kvDelete(actorId: string, key: KvKey): Promise<void> {
		await this.#getDOCtx(actorId).storage.delete(this.#serializeKey(key));
	}

	async kvDeleteBatch(actorId: string, keys: KvKey[]): Promise<void> {
		await this.#getDOCtx(actorId).storage.delete(keys.map(this.#serializeKey));
	}

	async setAlarm(actor: AnyActorInstance, timestamp: number): Promise<void> {
		await this.#getDOCtx(actor.id).storage.setAlarm(timestamp);
	}

	#serializeKey(key: KvKey): string {
		return JSON.stringify(key);
	}
}
