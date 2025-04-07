import type { ActorTags } from "@/mod";

/**
 * Class representing an actor's state
 */
export class ActorState {
	// Basic actor information
	initialized = true;
	id: string;
	name: string;
	tags: ActorTags;

	persistedData: unknown = undefined;

	constructor(id: string, name: string, tags: ActorTags) {
		this.id = id;
		this.name = name;
		this.tags = tags;
	}
}

/**
 * Global state singleton for the memory driver
 */
export class TestGlobalState {
	// Single map for all actor state
	#actors: Map<string, ActorState> = new Map();

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

	readPersistedData(actorId: string): unknown | undefined {
		return this.#getActor(actorId).persistedData;
	}

	writePersistedData(actorId: string, data: unknown) {
		this.#getActor(actorId).persistedData = data;
	}

	/**
	 * Create or update an actor
	 */
	createActor(actorId: string, name: string, tags: ActorTags): void {
		// Create actor state if it doesn't exist
		if (!this.#actors.has(actorId)) {
			this.#actors.set(actorId, new ActorState(actorId, name, tags));
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
