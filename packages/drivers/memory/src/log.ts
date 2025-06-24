import { getLogger } from "@rivetkit/core/log";

export const LOGGER_NAME = "driver-memory";

export function logger() {
    return getLogger(LOGGER_NAME);
}
