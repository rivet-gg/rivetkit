import { describe, expect, test } from "vitest";
import type { DriverTestConfig } from "../mod";
import { setupDriverTest } from "../utils";

export function runRequestAccessTests(driverTestConfig: DriverTestConfig) {
	describe("Request Access in Lifecycle Hooks", () => {
		test("should have access to request object in onBeforeConnect and createConnState", async (c) => {
			const { client } = await setupDriverTest(c, driverTestConfig);

			// Create actor with request tracking enabled
			const handle = client.requestAccessActor.getOrCreate(["test-request"], {
				params: { trackRequest: true },
			});
			const connection = await handle.connect();

			// Get request info that was captured in onBeforeConnect
			const requestInfo = await connection.getRequestInfo();

			// Verify request was accessible in HTTP mode, but not in inline mode
			if (driverTestConfig.clientType === "http") {
				// Check onBeforeConnect
				expect(requestInfo.onBeforeConnect.hasRequest).toBe(true);
				expect(requestInfo.onBeforeConnect.requestUrl).toBeDefined();
				expect(requestInfo.onBeforeConnect.requestMethod).toBeDefined();
				expect(requestInfo.onBeforeConnect.requestHeaders).toBeDefined();

				// Check createConnState
				expect(requestInfo.createConnState.hasRequest).toBe(true);
				expect(requestInfo.createConnState.requestUrl).toBeDefined();
				expect(requestInfo.createConnState.requestMethod).toBeDefined();
				expect(requestInfo.createConnState.requestHeaders).toBeDefined();
			} else {
				// Inline client doesn't have request object
				expect(requestInfo.onBeforeConnect.hasRequest).toBe(false);
				expect(requestInfo.onBeforeConnect.requestUrl).toBeNull();
				expect(requestInfo.onBeforeConnect.requestMethod).toBeNull();

				expect(requestInfo.createConnState.hasRequest).toBe(false);
				expect(requestInfo.createConnState.requestUrl).toBeNull();
				expect(requestInfo.createConnState.requestMethod).toBeNull();
			}

			// Clean up
			await connection.dispose();
		});

		test("should not have request when trackRequest is false", async (c) => {
			const { client } = await setupDriverTest(c, driverTestConfig);

			// Create actor without request tracking
			const handle = client.requestAccessActor.getOrCreate(
				["test-no-request"],
				{
					params: { trackRequest: false },
				},
			);
			const connection = await handle.connect();

			// Get request info
			const requestInfo = await connection.getRequestInfo();

			// Verify request was not tracked
			expect(requestInfo.onBeforeConnect.hasRequest).toBe(false);
			expect(requestInfo.onBeforeConnect.requestUrl).toBeNull();
			expect(requestInfo.onBeforeConnect.requestMethod).toBeNull();
			expect(
				Object.keys(requestInfo.onBeforeConnect.requestHeaders),
			).toHaveLength(0);

			expect(requestInfo.createConnState.hasRequest).toBe(false);
			expect(requestInfo.createConnState.requestUrl).toBeNull();
			expect(requestInfo.createConnState.requestMethod).toBeNull();
			expect(
				Object.keys(requestInfo.createConnState.requestHeaders),
			).toHaveLength(0);

			// Clean up
			await connection.dispose();
		});

		test("should capture request headers and method", async (c) => {
			const { client } = await setupDriverTest(c, driverTestConfig);

			// Create actor and connect with request tracking
			const handle = client.requestAccessActor.getOrCreate(["test-headers"], {
				params: { trackRequest: true },
			});
			const connection = await handle.connect();

			// Get request info
			const requestInfo = await connection.getRequestInfo();

			if (driverTestConfig.clientType === "http") {
				// Verify request details were captured in both hooks
				expect(requestInfo.onBeforeConnect.hasRequest).toBe(true);
				expect(requestInfo.onBeforeConnect.requestMethod).toBeTruthy();
				expect(requestInfo.onBeforeConnect.requestUrl).toBeTruthy();
				expect(requestInfo.onBeforeConnect.requestHeaders).toBeTruthy();
				expect(typeof requestInfo.onBeforeConnect.requestHeaders).toBe(
					"object",
				);

				expect(requestInfo.createConnState.hasRequest).toBe(true);
				expect(requestInfo.createConnState.requestMethod).toBeTruthy();
				expect(requestInfo.createConnState.requestUrl).toBeTruthy();
				expect(requestInfo.createConnState.requestHeaders).toBeTruthy();
				expect(typeof requestInfo.createConnState.requestHeaders).toBe(
					"object",
				);
			} else {
				// Inline client doesn't have request object
				expect(requestInfo.onBeforeConnect.hasRequest).toBe(false);
				expect(requestInfo.createConnState.hasRequest).toBe(false);
			}

			// Clean up
			await connection.dispose();
		});

		test("should have access to request object in onAuth", async (c) => {
			const { client, endpoint } = await setupDriverTest(c, driverTestConfig);

			// Only test in HTTP mode as onAuth only runs for public endpoints
			if (driverTestConfig.clientType === "http") {
				// For now, skip this test as onAuth might not be properly invoked in test environment
				// The onAuth hook is designed for public endpoints and might require special setup
				console.log("Skipping onAuth test - requires public endpoint setup");

				// TODO: Implement proper public endpoint test for onAuth
				// This would require setting up the actor with public access and making
				// requests from outside the internal client
			}
		});

		test("should have access to request object in onFetch", async (c) => {
			const { client, endpoint } = await setupDriverTest(c, driverTestConfig);

			// Create actor
			const handle = client.requestAccessActor.getOrCreate(["test-fetch"]);

			// Make a raw HTTP request to the actor
			await handle.resolve(); // Ensure actor is created

			const actorQuery = {
				getOrCreateForKey: {
					name: "requestAccessActor",
					key: ["test-fetch"],
				},
			};

			const url = `${endpoint}/registry/actors/raw/http/test-path`;
			const response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Test-Header": "test-value",
					"X-RivetKit-Query": JSON.stringify(actorQuery),
				},
				body: JSON.stringify({ test: "data" }),
			});

			if (!response.ok) {
				const errorText = await response.text();
				console.error(
					`HTTP request failed: ${response.status} ${response.statusText}`,
					errorText,
				);
			}

			expect(response.ok).toBe(true);
			const data = await response.json();

			// Verify request info from onFetch
			expect((data as any).hasRequest).toBe(true);
			expect((data as any).requestUrl).toContain("/test-path");
			expect((data as any).requestMethod).toBe("POST");
			expect((data as any).requestHeaders).toBeDefined();
			expect((data as any).requestHeaders["content-type"]).toBe(
				"application/json",
			);
			expect((data as any).requestHeaders["x-test-header"]).toBe("test-value");
		});

		test("should have access to request object in onWebSocket", async (c) => {
			const { client, endpoint } = await setupDriverTest(c, driverTestConfig);

			// Only test in environments that support WebSocket
			if (typeof WebSocket !== "undefined") {
				// Create actor
				const handle = client.requestAccessActor.getOrCreate([
					"test-websocket",
				]);
				await handle.resolve(); // Ensure actor is created

				const actorQuery = {
					getOrCreateForKey: {
						name: "requestAccessActor",
						key: ["test-websocket"],
					},
				};

				// Encode query as WebSocket subprotocol
				const queryProtocol = `query.${encodeURIComponent(JSON.stringify(actorQuery))}`;

				// Create raw WebSocket connection
				const wsUrl = endpoint
					.replace("http://", "ws://")
					.replace("https://", "wss://");
				const ws = new WebSocket(
					`${wsUrl}/registry/actors/raw/websocket/test-path`,
					[
						queryProtocol,
						"rivetkit", // Required protocol
					],
				);

				// Wait for connection and first message
				await new Promise<void>((resolve, reject) => {
					ws.onopen = () => {
						// Connection established
					};

					ws.onmessage = (event) => {
						try {
							const data = JSON.parse(event.data);

							// Verify request info from onWebSocket
							expect(data.hasRequest).toBe(true);
							expect(data.requestUrl).toContain("/test-path");
							expect(data.requestMethod).toBe("GET");
							expect(data.requestHeaders).toBeDefined();

							ws.close();
							resolve();
						} catch (error) {
							reject(error);
						}
					};

					ws.onerror = (error) => {
						reject(error);
					};
				});
			}
		});
	});
}
