import { getLogger } from "actor-core/log";

export const LOGGER_NAME = "nodejs";

export function logger() {
	return getLogger(LOGGER_NAME);
}
