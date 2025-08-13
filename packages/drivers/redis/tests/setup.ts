import { beforeAll } from "vitest";
import { getOrStartValkeyContainer } from "./test-utils";

beforeAll(async () => {
	console.log("Starting shared Valkey container...");
	const { port, containerId } = await getOrStartValkeyContainer();
	console.log(`Valkey container ready on port ${port} (ID: ${containerId})`);

	// Store the container info in environment variables for tests to use
	process.env.VALKEY_TEST_PORT = port.toString();
	process.env.VALKEY_TEST_CONTAINER_ID = containerId;
});
