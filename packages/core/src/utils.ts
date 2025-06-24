export { assertUnreachable } from "./common/utils";
export { stringifyError } from "@/common/utils";
import { Context as HonoContext, Handler as HonoHandler } from "hono";

import pkgJson from "../package.json" with { type: "json" };
import { DriverConfig, UserError } from "./mod";
import { createMemoryDriver } from "./drivers/memory/mod";
import { createRivetManagerDriver } from "./drivers/rivet/mod";
import { logger } from "./worker/log";

export const VERSION = pkgJson.version;

let _userAgent: string | undefined = undefined;

export function httpUserAgent(): string {
	// Return cached value if already initialized
	if (_userAgent !== undefined) {
		return _userAgent;
	}

	// Library
	let userAgent = `RivetKit/${VERSION}`;

	// Navigator
	const navigatorObj = typeof navigator !== "undefined" ? navigator : undefined;
	if (navigatorObj?.userAgent) userAgent += ` ${navigatorObj.userAgent}`;

	_userAgent = userAgent;

	return userAgent;
}

export type UpgradeWebSocket = (
	createEvents: (c: HonoContext) => any,
) => HonoHandler;

/**
 * Determines which driver to use if none is provided.
 */
export function getDefaultDriver(): DriverConfig {
	const driver = getEnvUniversal("RIVETKIT_DRIVER");
	console.log("driver", driver);
	if (!driver || driver === "memory") {
		logger().info("using default memory driver");
		return createMemoryDriver();
	} else if (driver === "rivet") {
		logger().info("using default rivet driver");
		return createRivetManagerDriver();
	} else {
		throw new UserError(`Unrecognized driver: ${driver}`);
	}
}

export function getEnvUniversal(key: string): string | undefined {
	if (typeof Deno !== "undefined") {
		return Deno.env.get(key);
	} else if (typeof process !== "undefined") {
		// Do this after Deno since `process` is sometimes polyfilled
		return process.env[key];
	}
}
