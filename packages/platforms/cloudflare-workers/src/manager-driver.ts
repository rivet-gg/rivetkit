// import type {
// 	ManagerDriver,
// 	GetForIdInput,
// 	GetWithKeyInput,
// 	ActorOutput,
// 	CreateInput,
// 	GetOrCreateWithKeyInput,
// } from "@rivetkit/core/driver-helpers";
// import { ActorAlreadyExists } from "@rivetkit/core/errors";
// import { Bindings } from "./mod";
// import { logger } from "./log";
// import { serializeNameAndKey, serializeKey } from "./util";
// import { getCloudflareAmbientEnv } from "./handler";
//
// // Actor metadata structure
// interface ActorData {
// 	name: string;
// 	key: string[];
// }
//
// // Key constants similar to Redis implementation
// const KEYS = {
// 	ACTOR: {
// 		// Combined key for actor metadata (name and key)
// 		metadata: (actorId: string) => `actor:${actorId}:metadata`,
//
// 		// Key index function for actor lookup
// 		keyIndex: (name: string, key: string[] = []) => {
// 			// Use serializeKey for consistent handling of all keys
// 			return `actor_key:${serializeKey(key)}`;
// 		},
// 	},
// };
//
// export class CloudflareActorsManagerDriver implements ManagerDriver {
// 	async getForId({
// 		c,
// 		actorId,
// 	}: GetForIdInput<{ Bindings: Bindings }>): Promise<ActorOutput | undefined> {
// 		const env = getCloudflareAmbientEnv();
//
// 		// Get actor metadata from KV (combined name and key)
// 		const actorData = (await env.ACTOR_KV.get(KEYS.ACTOR.metadata(actorId), {
// 			type: "json",
// 		})) as ActorData | null;
//
// 		// If the actor doesn't exist, return undefined
// 		if (!actorData) {
// 			return undefined;
// 		}
//
// 		return {
// 			actorId,
// 			name: actorData.name,
// 			key: actorData.key,
// 		};
// 	}
//
// 	async getWithKey({
// 		c,
// 		name,
// 		key,
// 	}: GetWithKeyInput<{ Bindings: Bindings }>): Promise<
// 		ActorOutput | undefined
// 	> {
// 		const env = getCloudflareAmbientEnv();
//
// 		logger().debug("getWithKey: searching for actor", { name, key });
//
// 		// Generate deterministic ID from the name and key
// 		// This is aligned with how createActor generates IDs
// 		const nameKeyString = serializeNameAndKey(name, key);
// 		const actorId = env.ACTOR_DO.idFromName(nameKeyString).toString();
//
// 		// Check if the actor metadata exists
// 		const actorData = await env.ACTOR_KV.get(KEYS.ACTOR.metadata(actorId), {
// 			type: "json",
// 		});
//
// 		if (!actorData) {
// 			logger().debug("getWithKey: no actor found with matching name and key", {
// 				name,
// 				key,
// 				actorId,
// 			});
// 			return undefined;
// 		}
//
// 		logger().debug("getWithKey: found actor with matching name and key", {
// 			actorId,
// 			name,
// 			key,
// 		});
// 		return this.#buildActorOutput(c, actorId);
// 	}
//
// 	async getOrCreateWithKey(
// 		input: GetOrCreateWithKeyInput,
// 	): Promise<ActorOutput> {
// 		// TODO: Prevent race condition here
// 		const getOutput = await this.getWithKey(input);
// 		if (getOutput) {
// 			return getOutput;
// 		} else {
// 			return await this.createActor(input);
// 		}
// 	}
//
// 	async createActor({
// 		c,
// 		name,
// 		key,
// 		input,
// 	}: CreateInput<{ Bindings: Bindings }>): Promise<ActorOutput> {
// 		const env = getCloudflareAmbientEnv();
//
// 		// Check if actor with the same name and key already exists
// 		const existingActor = await this.getWithKey({ c, name, key });
// 		if (existingActor) {
// 			throw new ActorAlreadyExists(name, key);
// 		}
//
// 		// Create a deterministic ID from the actor name and key
// 		// This ensures that actors with the same name and key will have the same ID
// 		const nameKeyString = serializeNameAndKey(name, key);
// 		const doId = env.ACTOR_DO.idFromName(nameKeyString);
// 		const actorId = doId.toString();
//
// 		// Init actor
// 		const actor = env.ACTOR_DO.get(doId);
// 		await actor.initialize({
// 			name,
// 			key,
// 			input,
// 		});
//
// 		// Store combined actor metadata (name and key)
// 		const actorData: ActorData = { name, key };
// 		await env.ACTOR_KV.put(
// 			KEYS.ACTOR.metadata(actorId),
// 			JSON.stringify(actorData),
// 		);
//
// 		// Add to key index for lookups by name and key
// 		await env.ACTOR_KV.put(KEYS.ACTOR.keyIndex(name, key), actorId);
//
// 		return {
// 			actorId,
// 			name,
// 			key,
// 		};
// 	}
//
// 	// Helper method to build actor output from an ID
// 	async #buildActorOutput(
// 		c: any,
// 		actorId: string,
// 	): Promise<ActorOutput | undefined> {
// 		const env = getCloudflareAmbientEnv();
//
// 		const actorData = (await env.ACTOR_KV.get(KEYS.ACTOR.metadata(actorId), {
// 			type: "json",
// 		})) as ActorData | null;
//
// 		if (!actorData) {
// 			return undefined;
// 		}
//
// 		return {
// 			actorId,
// 			name: actorData.name,
// 			key: actorData.key,
// 		};
// 	}
// }
