import { getLogger } from "@rivetkit/core/log";

export const LOGGER_NAME = "nodejs";

export function logger() {
	return getLogger(LOGGER_NAME);
}
