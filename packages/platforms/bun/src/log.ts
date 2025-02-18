import { getLogger } from "actor-core/log";

export const LOGGER_NAME = "bun";

export function logger() {
	return getLogger(LOGGER_NAME);
}