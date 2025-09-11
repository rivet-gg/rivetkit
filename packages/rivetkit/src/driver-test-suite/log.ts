import { getLogger } from "@/common/log";

export const LOGGER_NAME = "test-suite";

export function logger() {
	return getLogger(LOGGER_NAME);
}
