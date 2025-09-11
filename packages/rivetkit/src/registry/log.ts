import { getLogger } from "@/common//log";

export const LOGGER_NAME = "registry";

export function logger() {
	return getLogger(LOGGER_NAME);
}
