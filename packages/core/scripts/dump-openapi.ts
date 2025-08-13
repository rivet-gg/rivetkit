import * as fs from "node:fs/promises";
import { resolve } from "node:path";
import { Context } from "hono";
import WebSocket from "ws";
import type { ClientDriver } from "@/client/client";
import { createFileSystemOrMemoryDriver } from "@/drivers/file-system/mod";
import type {
	ActorOutput,
	CreateInput,
	GetForIdInput,
	GetOrCreateWithKeyInput,
	GetWithKeyInput,
	ManagerDriver,
} from "@/manager/driver";
import { ActorQuery } from "@/manager/protocol/query";
import { createManagerRouter } from "@/manager/router";
import {
	Encoding,
	type RegistryConfig,
	RegistryConfigSchema,
	setup,
} from "@/mod";
import { type RunConfig, RunConfigSchema } from "@/registry/run-config";
import { VERSION } from "@/utils";

function main() {
	const registryConfig: RegistryConfig = RegistryConfigSchema.parse({
		use: {},
	});
	const registry = setup(registryConfig);

	const driverConfig: RunConfig = RunConfigSchema.parse({
		driver: createFileSystemOrMemoryDriver(false),
		getUpgradeWebSocket: () => () => unimplemented(),
	});

	const inlineClientDriver: ClientDriver = {
		action: unimplemented,
		resolveActorId: unimplemented,
		connectWebSocket: unimplemented,
		connectSse: unimplemented,
		sendHttpMessage: unimplemented,
		rawHttpRequest: unimplemented,
		rawWebSocket: unimplemented,
	};

	const managerDriver: ManagerDriver = {
		getForId: unimplemented,
		getWithKey: unimplemented,
		getOrCreateWithKey: unimplemented,
		createActor: unimplemented,
		sendRequest: unimplemented,
		openWebSocket: unimplemented,
		proxyRequest: unimplemented,
		proxyWebSocket: unimplemented,
	};

	const { openapi } = createManagerRouter(
		registryConfig,
		driverConfig,
		inlineClientDriver,
		managerDriver,
		true,
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
		"clients",
		"openapi",
		"openapi.json",
	);
	fs.writeFile(outputPath, JSON.stringify(openApiDoc, null, 2));
	console.log("Dumped OpenAPI to", outputPath);
}

function unimplemented(): never {
	throw new Error("UNIMPLEMENTED");
}

main();
