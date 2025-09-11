import { getLogger } from "@/common/log";

export const LOGGER_NAME = "nodejs";

export function logger() {
	return getLogger(LOGGER_NAME);
}
