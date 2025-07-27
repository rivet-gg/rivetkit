import type { Context as HonoContext } from "hono";
import type { AuthIntent } from "@/actor/config";
import type { AnyActorDefinition } from "@/actor/definition";
import * as errors from "@/actor/errors";
import type { RegistryConfig } from "@/registry/config";
import { stringifyError } from "@/utils";
import type { ManagerDriver } from "./driver";
import { logger } from "./log";
import type { ActorQuery } from "./protocol/query";

/**
 * Get authentication intents from a actor query
 */
export function getIntentsFromQuery(query: ActorQuery): Set<AuthIntent> {
	const intents = new Set<AuthIntent>();

	if ("getForId" in query) {
		intents.add("get");
	} else if ("getForKey" in query) {
		intents.add("get");
	} else if ("getOrCreateForKey" in query) {
		intents.add("get");
		intents.add("create");
	} else if ("create" in query) {
		intents.add("create");
	}

	return intents;
}

/**
 * Get actor name from a actor query
 */
export async function getActorNameFromQuery(
	c: HonoContext,
	driver: ManagerDriver,
	query: ActorQuery,
): Promise<string> {
	if ("getForId" in query) {
		// TODO: This will have a duplicate call to getForId between this and queryActor
		const output = await driver.getForId({
			c,
			actorId: query.getForId.actorId,
		});
		if (!output) throw new errors.ActorNotFound(query.getForId.actorId);
		return output.name;
	} else if ("getForKey" in query) {
		return query.getForKey.name;
	} else if ("getOrCreateForKey" in query) {
		return query.getOrCreateForKey.name;
	} else if ("create" in query) {
		return query.create.name;
	} else {
		throw new errors.InvalidRequest("Invalid query format");
	}
}

/**
 * Authenticate a request using the actor's onAuth function
 */
export async function authenticateRequest(
	c: HonoContext,
	actorDefinition: AnyActorDefinition,
	intents: Set<AuthIntent>,
	params: unknown,
): Promise<unknown> {
	if (!("onAuth" in actorDefinition.config)) {
		throw new errors.Forbidden(
			"Actor requires authentication but no onAuth handler is defined (https://rivet.gg/docs/actors/authentication/). Provide an empty handler to disable auth: `onAuth: () => {}`",
		);
	}

	try {
		const dataOrPromise = actorDefinition.config.onAuth({
			req: c.req.raw,
			intents,
			params,
		});
		if (dataOrPromise instanceof Promise) {
			return await dataOrPromise;
		} else {
			return dataOrPromise;
		}
	} catch (error) {
		logger().info("authentication error", { error: stringifyError(error) });
		throw error;
	}
}

/**
 * Simplified authentication for endpoints that combines all auth steps
 */
export async function authenticateEndpoint(
	c: HonoContext,
	driver: ManagerDriver,
	registryConfig: RegistryConfig,
	query: ActorQuery,
	additionalIntents: AuthIntent[],
	params: unknown,
): Promise<unknown> {
	// Get base intents from query
	const intents = getIntentsFromQuery(query);

	// Add endpoint-specific intents
	for (const intent of additionalIntents) {
		intents.add(intent);
	}

	// Get actor definition
	const actorName = await getActorNameFromQuery(c, driver, query);
	const actorDefinition = registryConfig.use[actorName];
	if (!actorDefinition) {
		throw new errors.ActorNotFound(actorName);
	}

	// Authenticate
	return await authenticateRequest(c, actorDefinition, intents, params);
}
