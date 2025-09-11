import { getLogger } from "@/common/log";

export const LOGGER_NAME = "driver-fs";

export function logger() {
	return getLogger(LOGGER_NAME);
}
