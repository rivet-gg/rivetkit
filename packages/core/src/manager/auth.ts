import * as errors from "@/worker/errors";
import type { Context as HonoContext } from "hono";
import type { WorkerQuery } from "./protocol/query";
import type { AuthIntent } from "@/worker/config";
import type { AnyWorkerDefinition } from "@/worker/definition";
import type { RegistryConfig } from "@/registry/config";
import { ManagerDriver } from "./driver";
import { stringifyError } from "@/utils";
import { logger } from "./log";

/**
 * Get authentication intents from a worker query
 */
export function getIntentsFromQuery(query: WorkerQuery): Set<AuthIntent> {
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
 * Get worker name from a worker query
 */
export async function getWorkerNameFromQuery(
	c: HonoContext,
	driver: ManagerDriver,
	query: WorkerQuery,
): Promise<string> {
	if ("getForId" in query) {
		// TODO: This will have a duplicate call to getForId between this and queryWorker
		const output = await driver.getForId({
			c,
			workerId: query.getForId.workerId,
		});
		if (!output) throw new errors.WorkerNotFound(query.getForId.workerId);
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
 * Authenticate a request using the worker's onAuth function
 */
export async function authenticateRequest(
	c: HonoContext,
	workerDefinition: AnyWorkerDefinition,
	intents: Set<AuthIntent>,
	params: unknown,
): Promise<unknown> {
	if (!workerDefinition.config.onAuth) {
		throw new errors.Forbidden(
			"Worker requires authentication but no onAuth handler is defined",
		);
	}

	try {
		const dataOrPromise = workerDefinition.config.onAuth({
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
		if (errors.WorkerError.isWorkerError(error)) {
			throw error;
		}
		throw new errors.Forbidden("Authentication failed");
	}
}

/**
 * Simplified authentication for endpoints that combines all auth steps
 */
export async function authenticateEndpoint(
	c: HonoContext,
	driver: ManagerDriver,
	registryConfig: RegistryConfig,
	query: WorkerQuery,
	additionalIntents: AuthIntent[],
	params: unknown,
): Promise<unknown> {
	// Get base intents from query
	const intents = getIntentsFromQuery(query);

	// Add endpoint-specific intents
	for (const intent of additionalIntents) {
		intents.add(intent);
	}

	// Get worker definition
	const workerName = await getWorkerNameFromQuery(c, driver, query);
	const workerDefinition = registryConfig.workers[workerName];
	if (!workerDefinition) {
		throw new errors.WorkerNotFound(workerName);
	}

	// Authenticate
	return await authenticateRequest(c, workerDefinition, intents, params);
}
