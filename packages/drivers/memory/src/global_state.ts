import type { ActorTags } from "actor-core";

/**
 * Class representing an actor's state
 */
export class ActorState {
	// Basic actor information
	initialized = true;
	id: string;
	tags: ActorTags;

	// KV store - maps serialized keys to serialized values
	kvStore: Map<string, string> = new Map();

	constructor(id: string, tags: ActorTags) {
		this.id = id;
		this.tags = tags;
	}
}

/**
 * Global state singleton for the memory driver
 */
export class GlobalState {
	// Singleton instance
	static #instance: GlobalState | null = null;

	// Single map for all actor state
	#actors: Map<string, ActorState> = new Map();

	/**
	 * Private constructor to enforce singleton
	 */
	private constructor() {}

	/**
	 * Get the singleton instance
	 */
	static getInstance(): GlobalState {
		if (!GlobalState.#instance) {
			GlobalState.#instance = new GlobalState();
		}
		return GlobalState.#instance;
	}

	/**
	 * Get an actor by ID, throwing an error if it doesn't exist
	 * @private
	 */
	#getActor(actorId: string): ActorState {
		const actor = this.#actors.get(actorId);
		if (!actor) {
			throw new Error(`Actor does not exist for ID: ${actorId}`);
		}
		return actor;
	}

	/**
	 * Get a value from KV store
	 */
	getKv(actorId: string, serializedKey: string): string | undefined {
		return this.#getActor(actorId).kvStore.get(serializedKey);
	}

	/**
	 * Put a value into KV store
	 */
	putKv(actorId: string, serializedKey: string, value: string): void {
		let actor = this.#actors.get(actorId);
		if (!actor) {
			// Create default tags with a name property
			const tags: ActorTags = { name: "default" };
			actor = new ActorState(actorId, tags);
			this.#actors.set(actorId, actor);
		}
		actor.kvStore.set(serializedKey, value);
	}

	/**
	 * Delete a value from KV store
	 */
	deleteKv(actorId: string, serializedKey: string): void {
		this.#getActor(actorId).kvStore.delete(serializedKey);
	}

	/**
	 * Create or update an actor
	 */
	createActor(actorId: string, tags: ActorTags): void {
		// Create actor state if it doesn't exist
		if (!this.#actors.has(actorId)) {
			this.#actors.set(actorId, new ActorState(actorId, tags));
		} else {
			throw new Error(`Actor already exists for ID: ${actorId}`);
		}
	}

	/**
	 * Find an actor by a filter function
	 * @param filter A function that takes an ActorState and returns true if it matches the filter criteria
	 * @returns The matching ActorState or undefined if no match is found
	 */
	findActor(filter: (actor: ActorState) => boolean): ActorState | undefined {
		for (const actor of this.#actors.values()) {
			if (filter(actor)) {
				return actor;
			}
		}
		return undefined;
	}

	/**
	 * Get actor state
	 */
	getActor(actorId: string): ActorState | undefined {
		return this.#actors.get(actorId);
	}
	
	/**
	 * Check if an actor exists
	 */
	hasActor(actorId: string): boolean {
		return this.#actors.has(actorId);
	}
}
