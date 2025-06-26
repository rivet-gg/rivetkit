import * as fs from "node:fs/promises";
import { resolve } from "node:path";
import type { ConnectionHandlers } from "@/actor/router-endpoints";
import type { ClientDriver } from "@/client/client";
import { createManagerRouter } from "@/manager/router";
import { type RegistryConfig, RegistryConfigSchema, setup } from "@/mod";
import { type RunConfig, RunConfigSchema } from "@/registry/run-config";
import {
    createMemoryDriver,
} from "@/drivers/memory/mod";
import { VERSION } from "@/utils";

function main() {
	const registryConfig: RegistryConfig = RegistryConfigSchema.parse({
		use: {},
	});
	const registry = setup(registryConfig);

	const driverConfig: RunConfig = RunConfigSchema.parse({
		driver: createMemoryDriver(),
		getUpgradeWebSocket: () => () => unimplemented(),
	});

	const sharedConnectionHandlers: ConnectionHandlers = {
		onConnectWebSocket: async () => {
			unimplemented();
		},
		onConnectSse: async (opts) => {
			unimplemented();
		},
		onAction: async (opts) => {
			unimplemented();
		},
		onConnMessage: async (opts) => {
			unimplemented();
		},
	};

	const inlineClientDriver: ClientDriver = {
		action: unimplemented,
		resolveActorId: unimplemented,
		connectWebSocket: unimplemented,
		connectSse: unimplemented,
		sendHttpMessage: unimplemented,
	};

	const { openapi } = createManagerRouter(
		registryConfig,
		driverConfig,
		inlineClientDriver,
		{
			routingHandler: {
				inline: {
					handlers: sharedConnectionHandlers,
				},
			},
		},
	);

	const openApiDoc = openapi.getOpenAPIDocument({
		openapi: "3.0.0",
		info: {
			version: VERSION,
			title: "RivetKit API",
		},
	});

	const outputPath = resolve(
		import.meta.dirname,
		"..",
		"..",
		"..",
		"docs",
		"openapi.json",
	);
	fs.writeFile(outputPath, JSON.stringify(openApiDoc, null, 2));
	console.log("Dumped OpenAPI to", outputPath);
}

function unimplemented(): never {
	throw new Error("UNIMPLEMENTED");
}

main();
