import type { ActorDriver, AnyActorInstance } from "@/driver-helpers/mod";
import type { FileSystemGlobalState } from "./global-state";

export type ActorDriverContext = Record<never, never>;

/**
 * File System implementation of the Actor Driver
 */
export class FileSystemActorDriver implements ActorDriver {
	#state: FileSystemGlobalState;

	constructor(state: FileSystemGlobalState) {
		this.#state = state;
	}

	/**
	 * Get the current storage directory path
	 */
	get storagePath(): string {
		return this.#state.storagePath;
	}

	getContext(_actorId: string): ActorDriverContext {
		return {};
	}

	async readPersistedData(actorId: string): Promise<Uint8Array | undefined> {
		console.log("reading data", this.#state.readPersistedData(actorId));
		return this.#state.readPersistedData(actorId);
	}

	async writePersistedData(actorId: string, data: Uint8Array): Promise<void> {
		console.log("writing data", data);
		this.#state.writePersistedData(actorId, data);

		// Save state to disk
		await this.#state.saveActorState(actorId);
	}

	async setAlarm(actor: AnyActorInstance, timestamp: number): Promise<void> {
		const delay = Math.max(0, timestamp - Date.now());
		setTimeout(() => {
			actor.onAlarm();
		}, delay);
	}

	getDatabase(actorId: string): Promise<unknown | undefined> {
		return Promise.resolve(undefined);
	}
}
