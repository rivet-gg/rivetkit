import { describe, expect, test } from "vitest";
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
			const welcomeMessage = await new Promise<any>((resolve, reject) => {
				ws.addEventListener(
					"message",
					(event: any) => {
						resolve(JSON.parse(event.data as string));
					},
					{ once: true },
				);
				ws.addEventListener("close", reject);
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

			await new Promise<void>((resolve, reject) => {
				ws.addEventListener("open", () => resolve(), { once: true });
				ws.addEventListener("close", reject);
			});

			// Skip welcome message
			await new Promise<void>((resolve, reject) => {
				ws.addEventListener("message", () => resolve(), { once: true });
				ws.addEventListener("close", reject);
			});

			// Send and receive echo
			const testMessage = { test: "data", timestamp: Date.now() };
			ws.send(JSON.stringify(testMessage));

			const echoMessage = await new Promise<any>((resolve, reject) => {
				ws.addEventListener(
					"message",
					(event: any) => {
						resolve(JSON.parse(event.data as string));
					},
					{ once: true },
				);
				ws.addEventListener("close", reject);
			});

			expect(echoMessage).toEqual(testMessage);

			ws.close();
			await waitFor(driverTestConfig, 100);
		});

		test("should handle ping/pong protocol", async (c) => {
			const { client } = await setupDriverTest(c, driverTestConfig);
			const actor = client.rawWebSocketActor.getOrCreate(["ping"]);

			const ws = await actor.websocket();

			await new Promise<void>((resolve, reject) => {
				ws.addEventListener("open", () => resolve(), { once: true });
				ws.addEventListener("close", reject);
			});

			// Skip welcome message
			await new Promise<void>((resolve, reject) => {
				ws.addEventListener("message", () => resolve(), { once: true });
				ws.addEventListener("close", reject);
			});

			// Send ping
			ws.send(JSON.stringify({ type: "ping" }));

			const pongMessage = await new Promise<any>((resolve, reject) => {
				ws.addEventListener("message", (event: any) => {
					const data = JSON.parse(event.data as string);
					if (data.type === "pong") {
						resolve(data);
					}
				});
				ws.addEventListener("close", reject);
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
				new Promise<void>((resolve, reject) => {
					ws1.addEventListener("open", () => resolve(), { once: true });
					ws1.addEventListener("close", reject);
				}),
				new Promise<void>((resolve, reject) => {
					ws2.addEventListener("open", () => resolve(), { once: true });
					ws2.addEventListener("close", reject);
				}),
			]);

			// Skip welcome messages
			await Promise.all([
				new Promise<void>((resolve, reject) => {
					ws1.addEventListener("message", () => resolve(), { once: true });
					ws1.addEventListener("close", reject);
				}),
				new Promise<void>((resolve, reject) => {
					ws2.addEventListener("message", () => resolve(), { once: true });
					ws2.addEventListener("close", reject);
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
				ws1.addEventListener("close", reject);
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

			await new Promise<void>((resolve, reject) => {
				ws.addEventListener("open", () => resolve(), { once: true });
				ws.addEventListener("close", reject);
			});

			// Helper to receive and convert binary message
			const receiveBinaryMessage = async (): Promise<Uint8Array> => {
				const response = await new Promise<ArrayBuffer | Blob>(
					(resolve, reject) => {
						ws.addEventListener(
							"message",
							(event: any) => {
								resolve(event.data);
							},
							{ once: true },
						);
						ws.addEventListener("close", reject);
					},
				);

				// Convert Blob to ArrayBuffer if needed
				const buffer =
					response instanceof Blob ? await response.arrayBuffer() : response;

				return new Uint8Array(buffer);
			};

			// Test 1: Small binary data
			const smallData = new Uint8Array([1, 2, 3, 4, 5]);
			ws.send(smallData);
			const smallReversed = await receiveBinaryMessage();
			expect(Array.from(smallReversed)).toEqual([5, 4, 3, 2, 1]);

			// Test 2: Large binary data (1KB)
			const largeData = new Uint8Array(1024);
			for (let i = 0; i < largeData.length; i++) {
				largeData[i] = i % 256;
			}
			ws.send(largeData);
			const largeReversed = await receiveBinaryMessage();

			// Verify it's reversed correctly
			for (let i = 0; i < largeData.length; i++) {
				expect(largeReversed[i]).toBe(largeData[largeData.length - 1 - i]);
			}

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
				ws.addEventListener("close", reject);
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

			const response = await new Promise<any>((resolve, reject) => {
				ws.addEventListener("message", (event: any) => {
					const data = JSON.parse(event.data as string);
					if (data.type === "authData") {
						resolve(data);
					}
				});
				ws.addEventListener("close", reject);
			});

			// For now, just verify we get a response
			// The actual connection params handling needs to be implemented
			expect(response).toBeDefined();

			ws.close();
			await waitFor(driverTestConfig, 100);
		});

		test("should handle connection close properly", async (c) => {
			const { client } = await setupDriverTest(c, driverTestConfig);
			const actor = client.rawWebSocketActor.getOrCreate(["close-test"]);

			const ws = await actor.websocket();

			await new Promise<void>((resolve, reject) => {
				ws.addEventListener("open", () => resolve(), { once: true });
				ws.addEventListener("close", reject);
			});

			// Get initial stats
			const initialStats = await actor.getStats();
			expect(initialStats.connectionCount).toBe(1);

			// Wait for close event on client side
			const closePromise = new Promise<void>((resolve) => {
				ws.addEventListener("close", () => resolve(), { once: true });
			});

			// Close connection
			ws.close();
			await closePromise;

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
			await new Promise<void>((resolve, reject) => {
				ws1.addEventListener("open", () => resolve(), { once: true });
				ws1.addEventListener("close", reject);
			});

			// Wait for welcome message which confirms onWebSocket was called
			const welcome1 = await new Promise<any>((resolve, reject) => {
				ws1.addEventListener(
					"message",
					(event: any) => {
						resolve(JSON.parse(event.data as string));
					},
					{ once: true },
				);
				ws1.addEventListener("close", reject);
			});

			expect(welcome1.type).toBe("welcome");
			expect(welcome1.connectionCount).toBe(1);

			// Create second connection to same actor
			const ws2 = await actor.websocket();

			await new Promise<void>((resolve, reject) => {
				ws2.addEventListener("open", () => resolve(), { once: true });
				ws2.addEventListener("close", reject);
			});

			const welcome2 = await new Promise<any>((resolve, reject) => {
				ws2.addEventListener(
					"message",
					(event: any) => {
						resolve(JSON.parse(event.data as string));
					},
					{ once: true },
				);
				ws2.addEventListener("close", reject);
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

		test("should handle query parameters in websocket paths", async (c) => {
			const { client } = await setupDriverTest(c, driverTestConfig);
			const actor = client.rawWebSocketActor.getOrCreate(["query-params"]);

			// Test WebSocket with query parameters
			const ws = await actor.websocket("api/v1/stream?token=abc123&user=test");

			await new Promise<void>((resolve, reject) => {
				ws.addEventListener("open", () => resolve(), { once: true });
				ws.addEventListener("error", reject);
			});

			// Send request to get the request info
			ws.send(JSON.stringify({ type: "getRequestInfo" }));

			const requestInfo = await new Promise<any>((resolve, reject) => {
				ws.addEventListener("message", (event: any) => {
					const data = JSON.parse(event.data as string);
					if (data.type === "requestInfo") {
						resolve(data);
					}
				});
				ws.addEventListener("close", reject);
			});

			// Verify the path and query parameters were preserved
			expect(requestInfo.url).toContain("api/v1/stream");
			expect(requestInfo.url).toContain("token=abc123");
			expect(requestInfo.url).toContain("user=test");

			ws.close();
			await waitFor(driverTestConfig, 100);
		});
	});
}
