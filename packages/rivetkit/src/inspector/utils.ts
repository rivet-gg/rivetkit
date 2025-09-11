import crypto from "node:crypto";
import { createMiddleware } from "hono/factory";
import type { RunConfig } from "@/mod";
import type { RunConfigInput } from "@/registry/run-config";
import { inspectorLogger } from "./log";

export function compareSecrets(providedSecret: string, validSecret: string) {
	// Early length check to avoid unnecessary processing
	if (providedSecret.length !== validSecret.length) {
		return false;
	}

	const encoder = new TextEncoder();

	const a = encoder.encode(providedSecret);
	const b = encoder.encode(validSecret);

	if (a.byteLength !== b.byteLength) {
		return false;
	}

	// Perform timing-safe comparison
	if (!crypto.timingSafeEqual(a, b)) {
		return false;
	}
	return true;
}

export const secureInspector = (runConfig: RunConfig) =>
	createMiddleware(async (c, next) => {
		if (!runConfig.inspector.enabled) {
			return c.text("Inspector is not enabled", 503);
		}

		const userToken = c.req.header("Authorization")?.replace("Bearer ", "");
		if (!userToken) {
			return c.text("Unauthorized", 401);
		}

		const inspectorToken = runConfig.inspector.token?.();
		if (!inspectorToken) {
			return c.text("Unauthorized", 401);
		}

		const isValid = compareSecrets(userToken, inspectorToken);

		if (!isValid) {
			return c.text("Unauthorized", 401);
		}
		await next();
	});

export function getInspectorUrl(runConfig: RunConfigInput | undefined) {
	if (!runConfig?.inspector?.enabled) {
		return "disabled";
	}

	const accessToken = runConfig?.inspector?.token?.();

	if (!accessToken) {
		inspectorLogger().warn(
			"Inspector Token is not set, but Inspector is enabled. Please set it in the run configuration `inspector.token` or via `RIVETKIT_INSPECTOR_TOKEN` environment variable. Inspector will not be accessible.",
		);
		return "disabled";
	}

	const url = new URL("https://studio.rivet.gg");

	url.searchParams.set("t", accessToken);

	if (runConfig?.inspector?.defaultEndpoint) {
		url.searchParams.set("u", runConfig.inspector.defaultEndpoint);
	}

	return url.href;
}
