import { getLogger } from "@/common/log";

export const LOGGER_NAME = "driver-memory";

export function logger() {
    return getLogger(LOGGER_NAME);
}
