import type {
	GetOrCreateWithKeyInput,
	GetForIdInput,
	GetWithKeyInput,
	ManagerDriver,
	ActorOutput,
	CreateInput,
} from "@/driver-helpers/mod";
import { ActorAlreadyExists } from "@/actor/errors";
import { logger } from "./log";
import type { FileSystemGlobalState } from "./global-state";
import { generateActorId } from "./utils";
import { ManagerInspector } from "@/inspector/manager";
import { ActorFeature, type Actor, type ActorId } from "@/inspector/mod";

export class FileSystemManagerDriver implements ManagerDriver {
	#state: FileSystemGlobalState;

	inspector = new ManagerInspector(() => {
		const startedAt = new Date().toISOString();
		return {
			getAllActors: async ({ cursor, limit }) => {
				const itr = this.#state.getActorsIterator({ cursor });
				const actors: Actor[] = [];
				for (let i = 0; i < limit; i++) {
					const res = itr.next();
					if (!res.done) {
						actors.push({
							id: res.value.id as ActorId,
							name: res.value.name,
							key: res.value.key,
							startedAt,
							createdAt:
								res.value.createdAt?.toISOString() || new Date().toISOString(),
							features: [
								ActorFeature.State,
								ActorFeature.Connections,
								ActorFeature.Console,
							],
						});
					} else {
						break;
					}
				}
				return actors;
			},
			getActorById: async (id) => {
				try {
					const result = this.#state.loadActorState(id);
					return {
						id: result.id as ActorId,
						name: result.name,
						key: result.key,
						startedAt,
						createdAt:
							result.createdAt?.toISOString() || new Date().toISOString(),
						features: [
							ActorFeature.State,
							ActorFeature.Connections,
							ActorFeature.Console,
						],
					};
				} catch {
					return null;
				}
			},
		};
	});

	constructor(state: FileSystemGlobalState) {
		this.#state = state;
	}

	async getForId({ actorId }: GetForIdInput): Promise<ActorOutput | undefined> {
		// Validate the actor exists
		if (!this.#state.hasActor(actorId)) {
			return undefined;
		}

		try {
			// Load actor state
			const state = this.#state.loadActorState(actorId);

			return {
				actorId,
				name: state.name,
				key: state.key,
			};
		} catch (error) {
			logger().error("failed to read actor state", { actorId, error });
			return undefined;
		}
	}

	async getWithKey({
		name,
		key,
	}: GetWithKeyInput): Promise<ActorOutput | undefined> {
		// Generate the deterministic actor ID
		const actorId = generateActorId(name, key);

		// Check if actor exists
		if (this.#state.hasActor(actorId)) {
			return {
				actorId,
				name,
				key,
			};
		}

		return undefined;
	}

	async getOrCreateWithKey(
		input: GetOrCreateWithKeyInput,
	): Promise<ActorOutput> {
		// First try to get the actor without locking
		const getOutput = await this.getWithKey(input);
		if (getOutput) {
			return getOutput;
		} else {
			return await this.createActor(input);
		}
	}

	async createActor({ name, key, input }: CreateInput): Promise<ActorOutput> {
		// Generate the deterministic actor ID
		const actorId = generateActorId(name, key);

		// Check if actor already exists
		if (this.#state.hasActor(actorId)) {
			throw new ActorAlreadyExists(name, key);
		}

		await this.#state.createActor(actorId, name, key, input);

		return {
			actorId,
			name,
			key,
		};
	}
}
