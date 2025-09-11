import { getLogger } from "@/common//log";

export const LOGGER_NAME = "inline-client-driver";

export function logger() {
	return getLogger(LOGGER_NAME);
}
