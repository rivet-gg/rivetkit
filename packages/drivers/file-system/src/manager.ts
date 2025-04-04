import * as crypto from "node:crypto";
import type {
	CreateActorInput,
	CreateActorOutput,
	GetActorOutput,
	GetForIdInput,
	GetWithTagsInput,
	ManagerDriver,
} from "actor-core/driver-helpers";
import { logger } from "./log";
import type { FileSystemGlobalState } from "./global_state";
import type { ActorCoreApp } from "actor-core";
import { ManagerInspector } from "actor-core/inspector";

export class FileSystemManagerDriver implements ManagerDriver {
	#state: FileSystemGlobalState;

	/**
	 * @internal
	 */
	inspector: ManagerInspector = new ManagerInspector(this, {
		getAllActors: () => this.#state.getAllActors(),
		getAllTypesOfActors: () => Object.keys(this.app.config.actors),
	});

	constructor(
		private readonly app: ActorCoreApp<any>,
		state: FileSystemGlobalState,
	) {
		this.#state = state;
	}

	async getForId({
		baseUrl,
		actorId,
	}: GetForIdInput): Promise<GetActorOutput | undefined> {
		// Validate the actor exists
		if (!this.#state.hasActor(actorId)) {
			return undefined;
		}

		try {
			// Load actor state
			const state = this.#state.loadActorState(actorId);

			return {
				endpoint: buildActorEndpoint(baseUrl, actorId),
				name: state.name,
				tags: state.tags,
			};
		} catch (error) {
			logger().error("failed to read actor state", { actorId, error });
			return undefined;
		}
	}

	async getWithTags({
		baseUrl,
		name,
		tags,
	}: GetWithTagsInput): Promise<GetActorOutput | undefined> {
		try {
			// Use the existing findActor method from global state
			const actorId = this.#state.findActor(name, tags);

			if (actorId) {
				return {
					endpoint: buildActorEndpoint(baseUrl, actorId),
					name,
					tags,
				};
			}
		} catch (error) {
			logger().error("failed to search for actors", { name, tags, error });
		}

		return undefined;
	}

	async createActor({
		baseUrl,
		name,
		tags,
	}: CreateActorInput): Promise<CreateActorOutput> {
		const actorId = crypto.randomUUID();
		await this.#state.createActor(actorId, name, tags);
		
		// Notify inspector about actor changes
		this.inspector.onActorsChange(this.#state.getAllActors());
		
		return {
			endpoint: buildActorEndpoint(baseUrl, actorId),
		};
	}
}

function buildActorEndpoint(baseUrl: string, actorId: string) {
	return `${baseUrl}/actors/${actorId}`;
}
