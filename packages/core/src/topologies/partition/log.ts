import { getLogger } from "@/common//log";

export const LOGGER_NAME = "actor-partition";

export function logger() {
	return getLogger(LOGGER_NAME);
}
