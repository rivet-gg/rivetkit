import { createManagerRouter } from "@/manager/router";
import { RegistryConfig, RegistryConfigSchema, Encoding, setup } from "@/mod";
import { ConnectionHandlers } from "@/worker/router-endpoints";
import {
	TestGlobalState,
	TestWorkerDriver,
	TestManagerDriver,
} from "@/test/driver/mod";
import { OpenAPIHono } from "@hono/zod-openapi";
import { VERSION } from "@/utils";
import * as fs from "node:fs/promises";
import { resolve } from "node:path";
import { ClientDriver } from "@/client/client";
import { WorkerQuery } from "@/manager/protocol/query";
import { ToServer } from "@/worker/protocol/message/to-server";
import { EventSource } from "eventsource";
import { Context } from "hono";
import {
	DriverConfig,
	RunConfig,
	RunConfigSchema,
} from "@/registry/run-config";

function main() {
	const registryConfig: RegistryConfig = RegistryConfigSchema.parse({
		workers: {},
	});
	const registry = setup(registryConfig);

	const memoryState = new TestGlobalState();
	const driverConfig: RunConfig = RunConfigSchema.parse({
		driver: {
			topology: "standalone",
			worker: new TestWorkerDriver(memoryState),
			manager: new TestManagerDriver(memoryState),
		},
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
		resolveWorkerId: unimplemented,
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
