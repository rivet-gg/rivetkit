import { getLogger } from "rivetkit/log";

export const LOGGER_NAME = "driver-cloudflare-workers";

export function logger() {
	return getLogger(LOGGER_NAME);
}
