import { getLogger } from "@/common//log";

export const LOGGER_NAME = "actor-standalone";

export function logger() {
	return getLogger(LOGGER_NAME);
}
