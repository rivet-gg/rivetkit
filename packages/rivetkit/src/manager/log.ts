import { getLogger } from "@/common//log";

export const LOGGER_NAME = "actor-manager";

export function logger() {
	return getLogger(LOGGER_NAME);
}
