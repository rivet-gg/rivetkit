import type {
	CreateActorInput,
	CreateActorOutput,
	GetActorOutput,
	GetForIdInput,
	GetWithKeyInput,
	ManagerDriver,
} from "@/driver-helpers/mod";
import type { TestGlobalState } from "./global_state";
import { ManagerInspector } from "@/inspector/manager";
import type { ActorCoreApp } from "@/app/mod";

export class TestManagerDriver implements ManagerDriver {
	#state: TestGlobalState;

	/**
	 * @internal
	 */
	inspector: ManagerInspector = new ManagerInspector(this, {
		getAllActors: () => this.#state.getAllActors(),
		getAllTypesOfActors: () => Object.keys(this.app.config.actors),
	});

	constructor(
		private readonly app: ActorCoreApp<any>,
		state: TestGlobalState,
	) {
		this.#state = state;
	}

	async getForId({
		baseUrl,
		actorId,
	}: GetForIdInput): Promise<GetActorOutput | undefined> {
		// Validate the actor exists
		const actor = this.#state.getActor(actorId);
		if (!actor) {
			return undefined;
		}

		return {
			endpoint: buildActorEndpoint(baseUrl, actorId),
			name: actor.name,
			key: actor.key,
		};
	}

	async getWithKey({
		baseUrl,
		name,
		key,
	}: GetWithKeyInput): Promise<GetActorOutput | undefined> {
		// NOTE: This is a slow implementation that checks each actor individually.
		// This can be optimized with an index in the future.

		// Search through all actors to find a match with the same key
		const actor = this.#state.findActor((actor) => {
			if (actor.name !== name) return false;

			// Compare key arrays
			if (!actor.key || actor.key.length !== key.length) {
				return false;
			}

			// Check if all elements in key are in actor.key
			for (let i = 0; i < key.length; i++) {
				if (key[i] !== actor.key[i]) {
					return false;
				}
			}
			return true;
		});

		if (actor) {
			return {
				endpoint: buildActorEndpoint(baseUrl, actor.id),
				name,
				key: actor.key,
			};
		}

		return undefined;
	}

	async createActor({
		baseUrl,
		name,
		key,
	}: CreateActorInput): Promise<CreateActorOutput> {
		const actorId = crypto.randomUUID();
		this.#state.createActor(actorId, name, key);

		this.inspector.onActorsChange(this.#state.getAllActors());

		return {
			endpoint: buildActorEndpoint(baseUrl, actorId),
		};
	}
}

function buildActorEndpoint(baseUrl: string, actorId: string) {
	return `${baseUrl}/actors/${actorId}`;
}