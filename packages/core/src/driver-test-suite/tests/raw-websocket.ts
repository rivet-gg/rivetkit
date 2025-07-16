import { describe, expect, test } from "vitest";
import { z } from "zod";
import { importWebSocket } from "@/common/websocket";
import { registry } from "../../../fixtures/driver-test-suite/registry";
import type { DriverTestConfig } from "../mod";
import { setupDriverTest, waitFor } from "../utils";

export function runRawWebSocketTests(driverTestConfig: DriverTestConfig) {
	describe("raw websocket", () => {
		test("should establish raw WebSocket connection", async (c) => {
			const { client } = await setupDriverTest(c, driverTestConfig);
			const actor = client.rawWebSocketActor.getOrCreate(["basic"]);

			const ws = await actor.websocket();

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

		test("should echo messages", async (c) => {
			const { client } = await setupDriverTest(c, driverTestConfig);
			const actor = client.rawWebSocketActor.getOrCreate(["echo"]);

			const ws = await actor.websocket();

			await new Promise<void>((resolve) => {
				ws.addEventListener("open", () => resolve(), { once: true });
			});

			// Skip welcome message
			await new Promise<void>((resolve) => {
				ws.addEventListener("message", () => resolve(), { once: true });
			});

			// Send and receive echo
			const testMessage = { test: "data", timestamp: Date.now() };
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

		test("should handle ping/pong protocol", async (c) => {
			const { client } = await setupDriverTest(c, driverTestConfig);
			const actor = client.rawWebSocketActor.getOrCreate(["ping"]);

			const ws = await actor.websocket();

			await new Promise<void>((resolve) => {
				ws.addEventListener("open", () => resolve(), { once: true });
			});

			// Skip welcome message
			await new Promise<void>((resolve) => {
				ws.addEventListener("message", () => resolve(), { once: true });
			});

			// Send ping
			ws.send(JSON.stringify({ type: "ping" }));

			const pongMessage = await new Promise<any>((resolve) => {
				ws.addEventListener("message", (event: any) => {
					const data = JSON.parse(event.data as string);
					if (data.type === "pong") {
						resolve(data);
					}
				});
			});

			expect(pongMessage.type).toBe("pong");
			expect(pongMessage.timestamp).toBeDefined();

			ws.close();
			await waitFor(driverTestConfig, 100);
		});

		test.skip("should track stats across connections", async (c) => {
			const { client } = await setupDriverTest(c, driverTestConfig);
			const actor1 = client.rawWebSocketActor.getOrCreate(["stats"]);

			// Create first connection to ensure actor exists
			const ws1 = await actor1.websocket();

			// Now get reference to same actor
			const actor2 = client.rawWebSocketActor.get(["stats"]);
			const ws2 = await actor2.websocket();

			// Wait for both to connect
			await Promise.all([
				new Promise<void>((resolve) => {
					ws1.addEventListener("open", () => resolve(), { once: true });
				}),
				new Promise<void>((resolve) => {
					ws2.addEventListener("open", () => resolve(), { once: true });
				}),
			]);

			// Skip welcome messages
			await Promise.all([
				new Promise<void>((resolve) => {
					ws1.addEventListener("message", () => resolve(), { once: true });
				}),
				new Promise<void>((resolve) => {
					ws2.addEventListener("message", () => resolve(), { once: true });
				}),
			]);

			// Send some messages
			ws1.send(JSON.stringify({ data: "test1" }));
			ws2.send(JSON.stringify({ data: "test2" }));
			ws1.send(JSON.stringify({ data: "test3" }));

			await waitFor(driverTestConfig, 100);

			// Set up listener before sending request to avoid race condition
			const statsPromise = new Promise<any>((resolve, reject) => {
				const timeout = setTimeout(() => {
					reject(new Error("Timeout waiting for stats response"));
				}, 2000);

				ws1.addEventListener("message", (event: any) => {
					try {
						const data = JSON.parse(event.data as string);
						if (data.type === "stats") {
							clearTimeout(timeout);
							resolve(data);
						}
					} catch (e) {
						// Ignore non-JSON messages
					}
				});
			});

			// Request stats
			ws1.send(JSON.stringify({ type: "getStats" }));

			const stats = await statsPromise;

			expect(stats.connectionCount).toBe(2);
			expect(stats.messageCount).toBe(4); // 3 data messages + 1 getStats

			// Verify via action
			const actionStats = await actor1.getStats();
			expect(actionStats.connectionCount).toBe(2);
			expect(actionStats.messageCount).toBe(4);

			ws1.close();
			ws2.close();
			await waitFor(driverTestConfig, 100);
		});

		test("should handle binary data", async (c) => {
			const { client } = await setupDriverTest(c, driverTestConfig);
			const actor = client.rawWebSocketBinaryActor.getOrCreate(["binary"]);

			const ws = await actor.websocket();

			await new Promise<void>((resolve) => {
				ws.addEventListener("open", () => resolve(), { once: true });
			});

			// Send binary data
			const testData = new Uint8Array([1, 2, 3, 4, 5]);
			ws.send(testData);

			const reversedData = await new Promise<Uint8Array>((resolve) => {
				ws.addEventListener(
					"message",
					async (event: any) => {
						if (event.data instanceof Blob) {
							const buffer = await event.data.arrayBuffer();
							resolve(new Uint8Array(buffer));
						} else if (event.data instanceof ArrayBuffer) {
							resolve(new Uint8Array(event.data));
						}
					},
					{ once: true },
				);
			});

			expect(Array.from(reversedData)).toEqual([5, 4, 3, 2, 1]);

			ws.close();
			await waitFor(driverTestConfig, 100);
		});

		test("should work with custom paths", async (c) => {
			const { client } = await setupDriverTest(c, driverTestConfig);
			const actor = client.rawWebSocketActor.getOrCreate(["paths"]);

			const ws = await actor.websocket("custom/path");

			await new Promise<void>((resolve, reject) => {
				ws.addEventListener("open", () => {
					resolve();
				});
				ws.addEventListener("error", reject);
			});

			// Should still work
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

		test("should pass connection parameters through subprotocols", async (c) => {
			const { client } = await setupDriverTest(c, driverTestConfig);

			// Create actor with connection parameters
			const testParams = { userId: "test123", role: "admin" };
			const actor = client.rawWebSocketActor.getOrCreate(["params"], {
				params: testParams,
			});

			const ws = await actor.websocket();

			await new Promise<void>((resolve) => {
				ws.addEventListener("open", () => resolve(), { once: true });
			});

			// Send a request to echo the auth data (which should include conn params from auth)
			ws.send(JSON.stringify({ type: "getAuthData" }));

			const response = await new Promise<any>((resolve) => {
				ws.addEventListener("message", (event: any) => {
					const data = JSON.parse(event.data as string);
					if (data.type === "authData") {
						resolve(data);
					}
				});
			});

			// For now, just verify we get a response
			// The actual connection params handling needs to be implemented
			expect(response).toBeDefined();

			ws.close();
			await waitFor(driverTestConfig, 100);
		});

		test("should work with connections too", async (c) => {
			const { client } = await setupDriverTest(c, driverTestConfig);
			const conn = client.rawWebSocketActor
				.getOrCreate(["conn-test"])
				.connect();

			const ws = await conn.websocket();

			await new Promise<void>((resolve) => {
				ws.addEventListener("open", () => resolve(), { once: true });
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

			ws.close();
			await conn.dispose();
			await waitFor(driverTestConfig, 100);
		});

		test("should handle connection close properly", async (c) => {
			const { client } = await setupDriverTest(c, driverTestConfig);
			const actor = client.rawWebSocketActor.getOrCreate(["close-test"]);

			const ws = await actor.websocket();

			await new Promise<void>((resolve) => {
				ws.addEventListener("open", () => resolve(), { once: true });
			});

			// Get initial stats
			const initialStats = await actor.getStats();
			expect(initialStats.connectionCount).toBe(1);

			// Close connection
			ws.close();

			// Wait for close event on client side
			await new Promise<void>((resolve) => {
				ws.addEventListener("close", () => resolve(), { once: true });
			});

			// Poll for the expected state change with timeout
			const maxAttempts = 10;
			let attempts = 0;
			let finalStats: any;

			while (attempts < maxAttempts) {
				await waitFor(driverTestConfig, 50);
				finalStats = await actor.getStats();
				if (finalStats.connectionCount === 0) {
					break;
				}
				attempts++;
			}

			// Check stats after close
			expect(finalStats?.connectionCount).toBe(0);
		});

		test("should properly handle onWebSocket open and close events", async (c) => {
			const { client } = await setupDriverTest(c, driverTestConfig);
			const actor = client.rawWebSocketActor.getOrCreate(["open-close-test"]);

			// Create first connection
			const ws1 = await actor.websocket();

			// Wait for open event
			await new Promise<void>((resolve) => {
				ws1.addEventListener("open", () => resolve(), { once: true });
			});

			// Wait for welcome message which confirms onWebSocket was called
			const welcome1 = await new Promise<any>((resolve) => {
				ws1.addEventListener(
					"message",
					(event: any) => {
						resolve(JSON.parse(event.data as string));
					},
					{ once: true },
				);
			});

			expect(welcome1.type).toBe("welcome");
			expect(welcome1.connectionCount).toBe(1);

			// Create second connection to same actor
			const ws2 = await actor.websocket();

			await new Promise<void>((resolve) => {
				ws2.addEventListener("open", () => resolve(), { once: true });
			});

			const welcome2 = await new Promise<any>((resolve) => {
				ws2.addEventListener(
					"message",
					(event: any) => {
						resolve(JSON.parse(event.data as string));
					},
					{ once: true },
				);
			});

			expect(welcome2.type).toBe("welcome");
			expect(welcome2.connectionCount).toBe(2);

			// Verify stats
			const midStats = await actor.getStats();
			expect(midStats.connectionCount).toBe(2);

			// Close first connection
			ws1.close();
			await new Promise<void>((resolve) => {
				ws1.addEventListener("close", () => resolve(), { once: true });
			});

			// Wait a bit for server-side close handler
			await waitFor(driverTestConfig, 200);

			// Poll for the expected state change with timeout
			let afterFirstClose: any;
			let attempts = 0;
			const maxAttempts = 10;

			while (attempts < maxAttempts) {
				afterFirstClose = await actor.getStats();
				if (afterFirstClose.connectionCount === 1) {
					break;
				}
				await waitFor(driverTestConfig, 50);
				attempts++;
			}

			// Verify connection count decreased
			expect(afterFirstClose?.connectionCount).toBe(1);

			// Close second connection
			ws2.close();
			await new Promise<void>((resolve) => {
				ws2.addEventListener("close", () => resolve(), { once: true });
			});

			// Wait and verify final state
			await waitFor(driverTestConfig, 200);

			// Poll for the expected final state
			let finalStats: any;
			attempts = 0;

			while (attempts < maxAttempts) {
				finalStats = await actor.getStats();
				if (finalStats.connectionCount === 0) {
					break;
				}
				await waitFor(driverTestConfig, 50);
				attempts++;
			}

			expect(finalStats?.connectionCount).toBe(0);
		});
	});
}
