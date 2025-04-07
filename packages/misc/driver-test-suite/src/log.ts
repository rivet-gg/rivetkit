import { getLogger } from "actor-core/log";

export const LOGGER_NAME = "driver-test-suite";

export function logger() {
	return getLogger(LOGGER_NAME);
}
