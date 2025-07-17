import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { importWebSocket } from "@/common/websocket";
import type { ActorQuery } from "@/manager/protocol/query";
import type { DriverTestConfig } from "../mod";
import { waitFor } from "../utils";

export function runRawWebSocketDirectRegistryTests(
	driverTestConfig: DriverTestConfig,
) {
	describe("raw websocket - direct registry access", () => {
		test("should establish vanilla WebSocket connection with proper subprotocols", async (c) => {
			const projectPath = resolve(
				__dirname,
				"../../../fixtures/driver-test-suite",
			);
			const { endpoint, cleanup } = await driverTestConfig.start(projectPath);
			c.onTestFinished(cleanup);
			const WebSocket = await importWebSocket();

			// Build the actor query
			const actorQuery: ActorQuery = {
				getOrCreateForKey: {
					name: "rawWebSocketActor",
					key: ["vanilla-test"],
				},
			};

			// Encode query as WebSocket subprotocol
			const queryProtocol = `query.${encodeURIComponent(JSON.stringify(actorQuery))}`;

			// Build WebSocket URL (convert http to ws)
			const wsEndpoint = endpoint
				.replace(/^http:/, "ws:")
				.replace(/^https:/, "wss:");
			const wsUrl = `${wsEndpoint}/registry/actors/rawWebSocketActor/websocket/`;

			// Create WebSocket connection with subprotocol
			const ws = new WebSocket(wsUrl, [queryProtocol]) as any;

			await new Promise<void>((resolve, reject) => {
				ws.addEventListener("open", () => {
					resolve();
				});
				ws.addEventListener("error", reject);
			});

			// Should receive welcome message
			const welcomeMessage = await new Promise<any>((resolve) => {
				ws.addEventListener(
					"message",
					(event: any) => {
						resolve(JSON.parse(event.data as string));
					},
					{ once: true },
				);
			});

			expect(welcomeMessage.type).toBe("welcome");
			expect(welcomeMessage.connectionCount).toBe(1);

			ws.close();
			await waitFor(driverTestConfig, 100);
		});

		test("should echo messages with vanilla WebSocket", async (c) => {
			const projectPath = resolve(
				__dirname,
				"../../../fixtures/driver-test-suite",
			);
			const { endpoint, cleanup } = await driverTestConfig.start(projectPath);
			c.onTestFinished(cleanup);
			const WebSocket = await importWebSocket();

			const actorQuery: ActorQuery = {
				getOrCreateForKey: {
					name: "rawWebSocketActor",
					key: ["vanilla-echo"],
				},
			};

			const queryProtocol = `query.${encodeURIComponent(JSON.stringify(actorQuery))}`;

			const wsEndpoint = endpoint
				.replace(/^http:/, "ws:")
				.replace(/^https:/, "wss:");
			const wsUrl = `${wsEndpoint}/registry/actors/rawWebSocketActor/websocket/`;

			const ws = new WebSocket(wsUrl, [queryProtocol]) as any;

			await new Promise<void>((resolve) => {
				ws.addEventListener("open", () => resolve(), { once: true });
			});

			// Skip welcome message
			await new Promise<void>((resolve) => {
				ws.addEventListener("message", () => resolve(), { once: true });
			});

			// Send and receive echo
			const testMessage = { test: "vanilla", timestamp: Date.now() };
			ws.send(JSON.stringify(testMessage));

			const echoMessage = await new Promise<any>((resolve) => {
				ws.addEventListener(
					"message",
					(event: any) => {
						resolve(JSON.parse(event.data as string));
					},
					{ once: true },
				);
			});

			expect(echoMessage).toEqual(testMessage);

			ws.close();
			await waitFor(driverTestConfig, 100);
		});

		test("should handle connection parameters for authentication", async (c) => {
			const projectPath = resolve(
				__dirname,
				"../../../fixtures/driver-test-suite",
			);
			const { endpoint, cleanup } = await driverTestConfig.start(projectPath);
			c.onTestFinished(cleanup);
			const WebSocket = await importWebSocket();

			const actorQuery: ActorQuery = {
				getOrCreateForKey: {
					name: "rawWebSocketActor",
					key: ["vanilla-auth"],
				},
			};

			const connParams = { token: "ws-auth-token", userId: "ws-user123" };

			// Encode both query and connection params as subprotocols
			const queryProtocol = `query.${encodeURIComponent(JSON.stringify(actorQuery))}`;
			const connParamsProtocol = `conn_params.${encodeURIComponent(JSON.stringify(connParams))}`;

			const wsEndpoint = endpoint
				.replace(/^http:/, "ws:")
				.replace(/^https:/, "wss:");
			const wsUrl = `${wsEndpoint}/registry/actors/rawWebSocketActor/websocket/`;

			const ws = new WebSocket(wsUrl, [
				queryProtocol,
				connParamsProtocol,
			]) as any;

			await new Promise<void>((resolve, reject) => {
				ws.addEventListener("open", () => {
					resolve();
				});
				ws.addEventListener("error", reject);
			});

			// Connection should succeed with auth params
			const welcomeMessage = await new Promise<any>((resolve) => {
				ws.addEventListener(
					"message",
					(event: any) => {
						resolve(JSON.parse(event.data as string));
					},
					{ once: true },
				);
			});

			expect(welcomeMessage.type).toBe("welcome");

			ws.close();
			await waitFor(driverTestConfig, 100);
		});

		test("should handle custom user protocols alongside rivetkit protocols", async (c) => {
			const projectPath = resolve(
				__dirname,
				"../../../fixtures/driver-test-suite",
			);
			const { endpoint, cleanup } = await driverTestConfig.start(projectPath);
			c.onTestFinished(cleanup);
			const WebSocket = await importWebSocket();

			const actorQuery: ActorQuery = {
				getOrCreateForKey: {
					name: "rawWebSocketActor",
					key: ["vanilla-protocols"],
				},
			};

			// Include user-defined protocols
			const queryProtocol = `query.${encodeURIComponent(JSON.stringify(actorQuery))}`;
			const userProtocol1 = "chat-v1";
			const userProtocol2 = "custom-protocol";

			const wsEndpoint = endpoint
				.replace(/^http:/, "ws:")
				.replace(/^https:/, "wss:");
			const wsUrl = `${wsEndpoint}/registry/actors/rawWebSocketActor/websocket/`;

			const ws = new WebSocket(wsUrl, [
				queryProtocol,
				userProtocol1,
				userProtocol2,
			]) as any;

			await new Promise<void>((resolve, reject) => {
				ws.addEventListener("open", () => {
					resolve();
				});
				ws.addEventListener("error", reject);
			});

			// Should connect successfully with custom protocols
			const welcomeMessage = await new Promise<any>((resolve) => {
				ws.addEventListener(
					"message",
					(event: any) => {
						resolve(JSON.parse(event.data as string));
					},
					{ once: true },
				);
			});

			expect(welcomeMessage.type).toBe("welcome");

			ws.close();
			await waitFor(driverTestConfig, 100);
		});

		test("should handle different paths for WebSocket routes", async (c) => {
			const projectPath = resolve(
				__dirname,
				"../../../fixtures/driver-test-suite",
			);
			const { endpoint, cleanup } = await driverTestConfig.start(projectPath);
			c.onTestFinished(cleanup);
			const WebSocket = await importWebSocket();

			const actorQuery: ActorQuery = {
				getOrCreateForKey: {
					name: "rawWebSocketActor",
					key: ["vanilla-paths"],
				},
			};

			const queryProtocol = `query.${encodeURIComponent(JSON.stringify(actorQuery))}`;

			const wsEndpoint = endpoint
				.replace(/^http:/, "ws:")
				.replace(/^https:/, "wss:");

			// Test different paths
			const paths = ["chat/room1", "updates/feed", "stream/events"];

			for (const path of paths) {
				const wsUrl = `${wsEndpoint}/registry/actors/rawWebSocketActor/websocket/${path}`;
				const ws = new WebSocket(wsUrl, [queryProtocol]) as any;

				await new Promise<void>((resolve, reject) => {
					ws.addEventListener("open", () => {
						resolve();
					});
					ws.addEventListener("error", reject);
				});

				// Should receive welcome message with the path
				const welcomeMessage = await new Promise<any>((resolve) => {
					ws.addEventListener(
						"message",
						(event: any) => {
							resolve(JSON.parse(event.data as string));
						},
						{ once: true },
					);
				});

				expect(welcomeMessage.type).toBe("welcome");

				ws.close();
				await waitFor(driverTestConfig, 100);
			}
		});

		test("should return error for actors without onWebSocket handler", async (c) => {
			const projectPath = resolve(
				__dirname,
				"../../../fixtures/driver-test-suite",
			);
			const { endpoint, cleanup } = await driverTestConfig.start(projectPath);
			c.onTestFinished(cleanup);
			const WebSocket = await importWebSocket();

			const actorQuery: ActorQuery = {
				getOrCreateForKey: {
					name: "rawWebSocketNoHandlerActor",
					key: ["vanilla-no-handler"],
				},
			};

			const queryProtocol = `query.${encodeURIComponent(JSON.stringify(actorQuery))}`;

			const wsEndpoint = endpoint
				.replace(/^http:/, "ws:")
				.replace(/^https:/, "wss:");
			const wsUrl = `${wsEndpoint}/registry/actors/rawWebSocketNoHandlerActor/websocket/`;

			const ws = new WebSocket(wsUrl, [queryProtocol]) as any;

			// Should fail to connect
			await new Promise<void>((resolve) => {
				ws.addEventListener("error", () => resolve(), { once: true });
				ws.addEventListener("close", () => resolve(), { once: true });
			});

			expect(ws.readyState).toBe(ws.CLOSED || 3); // WebSocket.CLOSED
		});

		test("should handle binary data over vanilla WebSocket", async (c) => {
			const projectPath = resolve(
				__dirname,
				"../../../fixtures/driver-test-suite",
			);
			const { endpoint, cleanup } = await driverTestConfig.start(projectPath);
			c.onTestFinished(cleanup);
			const WebSocket = await importWebSocket();

			const actorQuery: ActorQuery = {
				getOrCreateForKey: {
					name: "rawWebSocketActor",
					key: ["vanilla-binary"],
				},
			};

			const queryProtocol = `query.${encodeURIComponent(JSON.stringify(actorQuery))}`;

			const wsEndpoint = endpoint
				.replace(/^http:/, "ws:")
				.replace(/^https:/, "wss:");
			const wsUrl = `${wsEndpoint}/registry/actors/rawWebSocketActor/websocket/`;

			const ws = new WebSocket(wsUrl, [queryProtocol]) as any;
			ws.binaryType = "arraybuffer";

			await new Promise<void>((resolve) => {
				ws.addEventListener("open", () => resolve(), { once: true });
			});

			// Skip welcome message
			await new Promise<void>((resolve) => {
				ws.addEventListener("message", () => resolve(), { once: true });
			});

			// Send binary data
			const binaryData = new Uint8Array([1, 2, 3, 4, 5]);
			ws.send(binaryData.buffer);

			// Receive echoed binary data
			const echoedData = await new Promise<ArrayBuffer>((resolve) => {
				ws.addEventListener(
					"message",
					(event: any) => {
						// The actor echoes binary data back as-is
						resolve(event.data as ArrayBuffer);
					},
					{ once: true },
				);
			});

			// Verify the echoed data matches what we sent
			const echoedArray = new Uint8Array(echoedData);
			expect(Array.from(echoedArray)).toEqual([1, 2, 3, 4, 5]);

			// Now test JSON echo
			ws.send(JSON.stringify({ type: "binary-test", size: binaryData.length }));

			const echoMessage = await new Promise<any>((resolve) => {
				ws.addEventListener(
					"message",
					(event: any) => {
						resolve(JSON.parse(event.data as string));
					},
					{ once: true },
				);
			});

			expect(echoMessage.type).toBe("binary-test");
			expect(echoMessage.size).toBe(5);

			ws.close();
			await waitFor(driverTestConfig, 100);
		});
	});
}
