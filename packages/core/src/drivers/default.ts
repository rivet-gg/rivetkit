import { UserError } from "@/actor/errors";
import { logger } from "@/actor/log";
import { createEngineDriver } from "@/drivers/engine/mod";
import { createFileSystemOrMemoryDriver } from "@/drivers/file-system/mod";
import type { DriverConfig, RunConfig } from "@/registry/run-config";
import { getEnvUniversal } from "@/utils";

/**
 * Chooses the appropriate driver based on the run configuration.
 */
export function chooseDefaultDriver(runConfig: RunConfig): DriverConfig {
	const engineEndpoint = runConfig.engine || getEnvUniversal("RIVET_ENGINE");

	if (engineEndpoint && runConfig.driver) {
		throw new UserError(
			"Cannot specify both 'engine' and 'driver' in configuration",
		);
	}

	if (runConfig.driver) {
		return runConfig.driver;
	}

	if (engineEndpoint) {
		logger().debug("using rivet engine driver", { endpoint: engineEndpoint });
		return createEngineDriver({ endpoint: engineEndpoint });
	}

	logger().debug("using default file system driver");
	return createFileSystemOrMemoryDriver(true);
}
