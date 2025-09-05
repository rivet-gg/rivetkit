import { apiCall } from "./api-utils";
import type { Config } from "./config";
import { serializeActorKey } from "./keys";

// MARK: Common types
export type RivetId = string;

export interface Actor {
	actor_id: RivetId;
	name: string;
	key: string;
	namespace_id: RivetId;
	runner_name_selector: string;
	create_ts: number;
	connectable_ts?: number | null;
	destroy_ts?: number | null;
	sleep_ts?: number | null;
	start_ts?: number | null;
}

export interface ActorsGetResponse {
	actor: Actor;
}

export interface ActorsGetByIdResponse {
	actor_id?: RivetId | null;
}

export interface ActorsGetOrCreateResponse {
	actor: Actor;
	created: boolean;
}

export interface ActorsGetOrCreateByIdResponse {
	actor_id: RivetId;
	created: boolean;
}

export interface ActorsCreateRequest {
	name: string;
	runner_name_selector: string;
	crash_policy: string;
	key?: string | null;
	input?: string | null;
}

export interface ActorsCreateResponse {
	actor: Actor;
}

// MARK: Get actor
export async function getActor(
	config: Config,
	actorId: RivetId,
): Promise<ActorsGetResponse> {
	return apiCall<never, ActorsGetResponse>(
		config.endpoint,
		config.namespace,
		"GET",
		`/actors/${encodeURIComponent(actorId)}`,
	);
}

// MARK: Get actor by id
export async function getActorById(
	config: Config,
	name: string,
	key: string[],
): Promise<ActorsGetByIdResponse> {
	const serializedKey = serializeActorKey(key);
	return apiCall<never, ActorsGetByIdResponse>(
		config.endpoint,
		config.namespace,
		"GET",
		`/actors/by-id?name=${encodeURIComponent(name)}&key=${encodeURIComponent(serializedKey)}`,
	);
}

// MARK: Get or create actor by id
export interface ActorsGetOrCreateByIdRequest {
	name: string;
	key: string;
	runner_name_selector: string;
	crash_policy: string;
	input?: string | null;
}

export async function getOrCreateActorById(
	config: Config,
	request: ActorsGetOrCreateByIdRequest,
): Promise<ActorsGetOrCreateByIdResponse> {
	return apiCall<ActorsGetOrCreateByIdRequest, ActorsGetOrCreateByIdResponse>(
		config.endpoint,
		config.namespace,
		"PUT",
		`/actors/by-id`,
		request,
	);
}

// MARK: Create actor
export async function createActor(
	config: Config,
	request: ActorsCreateRequest,
): Promise<ActorsCreateResponse> {
	return apiCall<ActorsCreateRequest, ActorsCreateResponse>(
		config.endpoint,
		config.namespace,
		"POST",
		`/actors`,
		request,
	);
}

// MARK: Destroy actor
export type ActorsDeleteResponse = {};

export async function destroyActor(
	config: Config,
	actorId: RivetId,
): Promise<ActorsDeleteResponse> {
	return apiCall<never, ActorsDeleteResponse>(
		config.endpoint,
		config.namespace,
		"DELETE",
		`/actors/${encodeURIComponent(actorId)}`,
	);
}
