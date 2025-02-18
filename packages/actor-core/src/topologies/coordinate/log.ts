import { getLogger } from "@/common/log";

export const LOGGER_NAME = "actor-coordinate";

export function logger() {
	return getLogger(LOGGER_NAME);
}
