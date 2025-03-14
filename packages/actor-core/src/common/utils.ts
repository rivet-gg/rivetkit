import { z } from "zod";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import * as errors from "@/actor/errors";
import { Logger } from "./log";

export const ActorTagsSchema = z
	.object({
		name: z.string(),
	})
	.catchall(z.string());

export const BuildTagsSchema = z
	.object({
		name: z.string(),
	})
	.catchall(z.string());

export type ActorTags = z.infer<typeof ActorTagsSchema>;

// TODO: This does not belong as part of ActorCore
export type BuildTags = z.infer<typeof BuildTagsSchema>;

export interface RivetEnvironment {
	project?: string;
	environment?: string;
}

export function assertUnreachable(x: never): never {
	throw new Error(`Unreachable case: ${x}`);
}

/**
 * Safely stringifies an object, ensuring that the stringified object is under a certain size.
 * @param obj any object to stringify
 * @param maxSize maximum size of the stringified object in bytes
 * @returns stringified object
 */
export function safeStringify(obj: unknown, maxSize: number) {
	let size = 0;

	function replacer(key: string, value: unknown) {
		if (value === null || value === undefined) return value;
		const valueSize =
			typeof value === "string" ? value.length : JSON.stringify(value).length;
		size += key.length + valueSize;

		if (size > maxSize) {
			throw new Error(`JSON object exceeds size limit of ${maxSize} bytes.`);
		}

		return value;
	}

	return JSON.stringify(obj, replacer);
}

// TODO: Instead of doing this, use a temp var for state and attempt to write
// it. Roll back state if fails to serialize.

/**
 * Check if a value is JSON serializable.
 * Optionally pass an onInvalid callback to receive the path to invalid values.
 */
export function isJsonSerializable(
	value: unknown, 
	onInvalid?: (path: string) => void,
	currentPath = ""
): boolean {
	// Handle primitive types directly
	if (value === null || value === undefined) {
		return true;
	}
	
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			onInvalid?.(currentPath);
			return false;
		}
		return true;
	}
	
	if (typeof value === "boolean" || typeof value === "string") {
		return true;
	}

	// Handle arrays
	if (Array.isArray(value)) {
		for (let i = 0; i < value.length; i++) {
			const itemPath = currentPath ? `${currentPath}[${i}]` : `[${i}]`;
			if (!isJsonSerializable(value[i], onInvalid, itemPath)) {
				return false;
			}
		}
		return true;
	}

	// Handle plain objects
	if (typeof value === "object") {
		// Reject if it's not a plain object
		if (Object.getPrototypeOf(value) !== Object.prototype) {
			onInvalid?.(currentPath);
			return false;
		}
		
		// Check all properties recursively
		for (const key in value) {
			const propPath = currentPath ? `${currentPath}.${key}` : key;
			if (!isJsonSerializable(value[key as keyof typeof value], onInvalid, propPath)) {
				return false;
			}
		}
		return true;
	}

	// Not serializable
	onInvalid?.(currentPath);
	return false;
}

export interface DeconstructedError {
	statusCode: ContentfulStatusCode;
	code: string;
	message: string;
	metadata?: unknown;
}

/** Deconstructs error in to components that are used to build responses. */
export function deconstructError(
	error: unknown,
	logger: Logger,
	extraLog: Record<string, unknown>,
) {
	// Build response error information. Only return errors if flagged as public in order to prevent leaking internal behavior.
	//
	// We log the error here instead of after generating the code & message because we need to log the original error, not the masked internal error.
	let statusCode: ContentfulStatusCode;
	let code: string;
	let message: string;
	let metadata: unknown = undefined;
	if (error instanceof errors.ActorError && error.public) {
		statusCode = 400;
		code = error.code;
		message = String(error);
		metadata = error.metadata;

		logger.info("public error", {
			code,
			message,
			...extraLog,
		});
	} else {
		statusCode = 500;
		code = errors.INTERNAL_ERROR_CODE;
		message = errors.INTERNAL_ERROR_DESCRIPTION;
		metadata = {
			//url: `https://hub.rivet.gg/projects/${actorMetadata.project.slug}/environments/${actorMetadata.environment.slug}/actors?actorId=${actorMetadata.actor.id}`,
		} satisfies errors.InternalErrorMetadata;

		logger.warn("internal error", {
			error: String(error),
			stack: (error as Error)?.stack,
			...extraLog,
		});
	}

	return { statusCode, code, message, metadata };
}
