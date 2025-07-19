import type {
	GenericConnGlobalState,
	RegistryConfig,
	RunConfig,
} from "@rivetkit/core";
import type {
	ActorDriver,
	AnyActorInstance,
	ManagerDriver,
} from "@rivetkit/core/driver-helpers";
import type { RedisGlobalState } from "./global-state";

// Define AnyClient locally since it's not exported
type AnyClient = any;

export type ActorDriverContext = Record<never, never>;

/**
 * Redis implementation of the Actor Driver
 */
export class RedisActorDriver implements ActorDriver {
	#registryConfig: RegistryConfig;
	#runConfig: RunConfig;
	#managerDriver: ManagerDriver;
	#inlineClient: AnyClient;
	#state: RedisGlobalState;

	constructor(
		registryConfig: RegistryConfig,
		runConfig: RunConfig,
		managerDriver: ManagerDriver,
		inlineClient: AnyClient,
		state: RedisGlobalState,
	) {
		this.#registryConfig = registryConfig;
		this.#runConfig = runConfig;
		this.#managerDriver = managerDriver;
		this.#inlineClient = inlineClient;
		this.#state = state;
	}

	async loadActor(actorId: string): Promise<AnyActorInstance> {
		return this.#state.startActor(
			this.#registryConfig,
			this.#runConfig,
			this.#inlineClient,
			this,
			actorId,
		);
	}

	getGenericConnGlobalState(actorId: string): GenericConnGlobalState {
		return this.#state.getGenericConnGlobalState(actorId);
	}

	getContext(_actorId: string): ActorDriverContext {
		return {};
	}

	async readPersistedData(actorId: string): Promise<Uint8Array | undefined> {
		return this.#state.readPersistedData(actorId);
	}

	async writePersistedData(actorId: string, data: Uint8Array): Promise<void> {
		await this.#state.writePersistedData(actorId, data);
	}

	async setAlarm(actor: AnyActorInstance, timestamp: number): Promise<void> {
		await this.#state.setAlarm(actor.id, timestamp, () => {
			actor.onAlarm();
		});
	}

	getDatabase(actorId: string): Promise<unknown | undefined> {
		return Promise.resolve(undefined);
	}
}
