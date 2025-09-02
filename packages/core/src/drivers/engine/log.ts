import { getLogger } from "@/common/log";

export const LOGGER_NAME = "driver-engine";

export function logger() {
	return getLogger(LOGGER_NAME);
}
