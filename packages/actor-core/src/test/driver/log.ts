import { getLogger } from "@/common/log";

export const LOGGER_NAME = "driver-test";

export function logger() {
    return getLogger(LOGGER_NAME);
}
