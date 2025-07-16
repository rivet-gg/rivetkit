import { logger } from "@/actor/log";
import { createFileSystemDriver } from "@/drivers/file-system/mod";
import { createMemoryDriver } from "@/drivers/memory/mod";
import { type DriverConfig, UserError } from "@/mod";
import { getEnvUniversal } from "@/utils";

/**
 * Determines which driver to use if none is provided.
 */
export function createDefaultDriver(): DriverConfig {
	const driver = getEnvUniversal("RIVETKIT_DRIVER");
	if (!driver || driver === "file-system") {
		logger().info("using default file system driver");
		return createFileSystemDriver();
	} else if (driver === "memory") {
		logger().info("using default memory driver");
		return createMemoryDriver();
	} else {
		throw new UserError(`Unrecognized driver: ${driver}`);
	}
}
