// @ts-types="../../common/dist/log.d.ts"
import { getLogger } from "actor-core/log";

export const LOGGER_NAME = "driver-redis";

export function logger() {
	return getLogger(LOGGER_NAME);
}
