import { getLogger } from "@/common/log";

export const LOGGER_NAME = "topologies-common";

export function logger() {
	return getLogger(LOGGER_NAME);
}
