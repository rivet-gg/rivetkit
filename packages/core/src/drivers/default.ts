import { logger } from "@/actor/log";
import { createFileSystemOrMemoryDriver } from "@/drivers/file-system/mod";
import { type DriverConfig, UserError } from "@/mod";
import { getEnvUniversal } from "@/utils";

/**
 * Determines which driver to use if none is provided.
 */
export function createDefaultDriver(): DriverConfig {
	const driver = getEnvUniversal("RIVETKIT_DRIVER");
	if (!driver || driver === "file-system") {
		logger().debug("using default file system driver");
		return createFileSystemOrMemoryDriver(true);
	} else if (driver === "memory") {
		logger().debug("using default memory driver");
		return createFileSystemOrMemoryDriver(false);
	} else {
		throw new UserError(`Unrecognized driver: ${driver}`);
	}
}
