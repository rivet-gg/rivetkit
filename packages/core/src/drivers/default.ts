import { logger } from "@/actor/log";
import { createFileSystemDriver } from "@/drivers/file-system/mod";
import { type DriverConfig, UserError } from "@/mod";
import { getEnvUniversal } from "@/utils";

/**
 * Determines which driver to use if none is provided.
 */
export function createDefaultDriver(): DriverConfig {
	const driver = getEnvUniversal("RIVETKIT_DRIVER");
	if (!driver || driver === "file-system") {
		logger().info("using default file system driver");
		return createFileSystemDriver(true);
	} else if (driver === "memory") {
		logger().info("using default memory driver");
		return createFileSystemDriver(false);
	} else {
		throw new UserError(`Unrecognized driver: ${driver}`);
	}
}
