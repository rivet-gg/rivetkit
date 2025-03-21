//import { onTestFinished, vi } from "vitest";
//import getPort from "get-port";
//import { serve } from "@actor-core/nodejs";
//import { type Client, createClient } from "actor-core/client";
//import type { ActorCoreApp } from "actor-core";
//
//export const ADMIN_TOKEN = "test-admin";
//export const VERSION = "test";
//export const REGION = "test";
//
//export interface SetupTestResult<A extends ActorCoreApp<any>> {
//	client: Client<A>;
//}
//
//export async function setupTest<A extends ActorCoreApp<any>>(
//	app: A,
//): Promise<SetupTestResult<A>> {
//	vi.useFakeTimers();
//
//	// Start server with a random port
//	const port = await getPort();
//	const server = serve(app, { port });
//	onTestFinished(
//		async () => await new Promise((resolve) => server.close(() => resolve())),
//	);
//
//	// Create client
//	const client = createClient<A>(`http://127.0.0.1:${port}`);
//	onTestFinished(async () => await client.dispose());
//
//	return {
//		client,
//	};
//}
