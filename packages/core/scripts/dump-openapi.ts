import { createManagerRouter } from "@/manager/router";
import { RegistryConfig, RegistryConfigSchema, Encoding, setup } from "@/mod";
import { ConnectionHandlers } from  "@/actor/router-endpoints";
import {
	TestGlobalState,
	TestActorDriver,
	TestManagerDriver,
} from "@/test/driver/mod";
import { OpenAPIHono } from "@hono/zod-openapi";
import { VERSION } from "@/utils";
import * as fs from "node:fs/promises";
import { resolve } from "node:path";
import { ClientDriver } from "@/client/client";
import { ActorQuery } from "@/manager/protocol/query";
import { ToServer } from  "@/actor/protocol/message/to-server";
import { EventSource } from "eventsource";
import { Context } from "hono";
import {
	DriverConfig,
	RunConfig,
	RunConfigSchema,
} from "@/registry/run-config";

function main() {
	const registryConfig: RegistryConfig = RegistryConfigSchema.parse({
		actors: {},
	});
	const registry = setup(registryConfig);

	const memoryState = new TestGlobalState();
	const driverConfig: RunConfig = RunConfigSchema.parse({
		driver: {
			topology: "standalone",
			actor: new TestActorDriver(memoryState),
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
