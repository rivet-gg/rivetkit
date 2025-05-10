import type { ActorDriver, AnyActorInstance } from "actor-core/driver-helpers";
import type { FileSystemGlobalState } from "./global_state";

export type ActorDriverContext = Record<never, never>;

/**
 * File System implementation of the Actor Driver
 */
export class FileSystemActorDriver implements ActorDriver {
    #state: FileSystemGlobalState;
    #alarms: Map<string, { timeout: NodeJS.Timeout, timestamp: number }>;
    
    constructor(state: FileSystemGlobalState) {
        this.#state = state;
        this.#alarms = new Map();
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

    async readPersistedData(actorId: string): Promise<unknown | undefined> {
        return this.#state.readPersistedData(actorId);
    }

    async writePersistedData(actorId: string, data: unknown): Promise<void> {
        this.#state.writePersistedData(actorId, data);
        
        // Save state to disk
        await this.#state.saveActorState(actorId);
    }

    async setAlarm(actor: AnyActorInstance, timestamp: number): Promise<void> {
        const delay = Math.max(timestamp - Date.now(), 0);
        const timeout = setTimeout(() => {
            this.#alarms.delete(actor.id);
            actor.onAlarm();
        }, delay);
        this.#alarms.set(actor.id, { timeout, timestamp });
    }

    async getAlarm(actor: AnyActorInstance): Promise<number | null> {
        const alarm = this.#alarms.get(actor.id);
        return alarm ? alarm.timestamp : null;
    }

    async deleteAlarm(actor: AnyActorInstance): Promise<void> {
        const alarm = this.#alarms.get(actor.id);
        if (alarm) {
            clearTimeout(alarm.timeout);
            this.#alarms.delete(actor.id);
        }
    }
}
