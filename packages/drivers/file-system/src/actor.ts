import type { ActorDriver, KvKey, KvValue, AnyActorInstance } from "actor-core/driver-helpers";
import type { FileSystemGlobalState } from "./global_state";

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

    async kvGet(actorId: string, key: KvKey): Promise<KvValue | undefined> {
        const serializedKey = this.#serializeKey(key);
        const value = this.#state.getKv(actorId, serializedKey);

        if (value !== undefined) return JSON.parse(value);
        return undefined;
    }

    async kvGetBatch(
        actorId: string,
        keys: KvKey[],
    ): Promise<(KvValue | undefined)[]> {
        return keys.map(key => {
            const serializedKey = this.#serializeKey(key);
            const value = this.#state.getKv(actorId, serializedKey);
            return value !== undefined ? JSON.parse(value) : undefined;
        });
    }

    async kvPut(actorId: string, key: KvKey, value: KvValue): Promise<void> {
        const serializedKey = this.#serializeKey(key);
        this.#state.putKv(actorId, serializedKey, JSON.stringify(value));
        
        // Save state to disk
        await this.#state.saveActorState(actorId);
    }

    async kvPutBatch(
        actorId: string,
        keyValuePairs: [KvKey, KvValue][],
    ): Promise<void> {
        for (const [key, value] of keyValuePairs) {
            const serializedKey = this.#serializeKey(key);
            this.#state.putKv(actorId, serializedKey, JSON.stringify(value));
        }
        
        // Save state to disk after all changes
        await this.#state.saveActorState(actorId);
    }

    async kvDelete(actorId: string, key: KvKey): Promise<void> {
        const serializedKey = this.#serializeKey(key);
        const state = this.#state.loadActorState(actorId);
        
        // Delete value and save if it exists
        if (state.kvStore.has(serializedKey)) {
            this.#state.deleteKv(actorId, serializedKey);
            await this.#state.saveActorState(actorId);
        }
    }

    async kvDeleteBatch(actorId: string, keys: KvKey[]): Promise<void> {
        const state = this.#state.loadActorState(actorId);
        
        let hasChanges = false;
        for (const key of keys) {
            const serializedKey = this.#serializeKey(key);
            if (state.kvStore.has(serializedKey)) {
                this.#state.deleteKv(actorId, serializedKey);
                hasChanges = true;
            }
        }
        
        if (hasChanges) {
            await this.#state.saveActorState(actorId);
        }
    }

    async setAlarm(actor: AnyActorInstance, timestamp: number): Promise<void> {
        const delay = Math.max(0, timestamp - Date.now());
        setTimeout(() => {
            actor.onAlarm();
        }, delay);
    }

    // Simple key serialization without depending on keys.ts
    #serializeKey(key: KvKey): string {
        return JSON.stringify(key);
    }
}