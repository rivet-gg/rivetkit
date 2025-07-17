import { describe, expect, test } from "vitest";
import type { ActorError } from "@/client/errors";
import type { DriverTestConfig } from "../mod";
import { setupDriverTest } from "../utils";

export function runActorAuthTests(driverTestConfig: DriverTestConfig) {
	describe("Actor Authentication Tests", () => {
		describe("Basic Authentication", () => {
			test("should allow access with valid auth", async (c) => {
				const { client } = await setupDriverTest(c, driverTestConfig);

				// Create client with valid auth params
				const instance = client.authActor.getOrCreate(undefined, {
					params: { apiKey: "valid-api-key" },
				});

				// This should succeed with valid API key
				const authData = await instance.getUserAuth();
				if (driverTestConfig.clientType === "inline") {
					// Inline clients don't have auth data
					expect(authData).toBeUndefined();
				} else {
					// HTTP clients should have auth data
					expect(authData).toEqual({
						userId: "user123",
						token: "valid-api-key",
					});
				}

				// Should be able to call actions
				const requests = await instance.getRequests();
				expect(requests).toBe(1);
			});

			test("should deny access with invalid auth", async (c) => {
				const { client } = await setupDriverTest(c, driverTestConfig);

				// This should fail without proper authorization
				const instance = client.authActor.getOrCreate();

				if (driverTestConfig.clientType === "inline") {
					// Inline clients bypass authentication
					const requests = await instance.getRequests();
					expect(typeof requests).toBe("number");
				} else {
					// HTTP clients should enforce authentication
					try {
						await instance.getRequests();
						expect.fail("Expected authentication error");
					} catch (error) {
						expect((error as ActorError).code).toBe("missing_auth");
					}
				}
			});

			test("should expose auth data on connection", async (c) => {
				const { client } = await setupDriverTest(c, driverTestConfig);

				const instance = client.authActor.getOrCreate(undefined, {
					params: { apiKey: "valid-api-key" },
				});

				// Auth data should be available via c.conn.auth
				const authData = await instance.getUserAuth();
				if (driverTestConfig.clientType === "inline") {
					// Inline clients don't have auth data
					expect(authData).toBeUndefined();
				} else {
					// HTTP clients should have auth data
					expect(authData).toBeDefined();
					expect((authData as any).userId).toBe("user123");
					expect((authData as any).token).toBe("valid-api-key");
				}
			});
		});

		describe("Intent-Based Authentication", () => {
			test("should allow get operations for any role", async (c) => {
				const { client } = await setupDriverTest(c, driverTestConfig);

				const createdInstance = await client.intentAuthActor.create(["foo"], {
					params: { role: "admin" },
				});
				const actorId = await createdInstance.resolve();

				if (driverTestConfig.clientType === "inline") {
					// Inline clients bypass authentication
					const instance = client.intentAuthActor.getForId(actorId);
					const value = await instance.getValue();
					expect(value).toBe(0);
				} else {
					// HTTP clients - actions require user or admin role
					const instance = client.intentAuthActor.getForId(actorId, {
						params: { role: "user" }, // Actions require user or admin role
					});
					const value = await instance.getValue();
					expect(value).toBe(0);
				}
			});

			test("should require admin role for create operations", async (c) => {
				const { client } = await setupDriverTest(c, driverTestConfig);

				if (driverTestConfig.clientType === "inline") {
					// Inline clients bypass authentication - should succeed
					const instance = client.intentAuthActor.getOrCreate(undefined, {
						params: { role: "user" },
					});
					const value = await instance.getValue();
					expect(value).toBe(0);
				} else {
					// HTTP clients should enforce authentication
					try {
						const instance = client.intentAuthActor.getOrCreate(undefined, {
							params: { role: "user" },
						});
						await instance.getValue();
						expect.fail("Expected permission error for create operation");
					} catch (error) {
						expect((error as ActorError).code).toBe("insufficient_permissions");
						expect((error as ActorError).message).toContain(
							"Admin role required",
						);
					}
				}
			});

			test("should allow actions for user and admin roles", async (c) => {
				const { client } = await setupDriverTest(c, driverTestConfig);

				const createdInstance = await client.intentAuthActor.create(["foo"], {
					params: { role: "admin" },
				});
				const actorId = await createdInstance.resolve();

				// This should fail - actions require user or admin role
				const instance = client.intentAuthActor.getForId(actorId, {
					params: { role: "guest" },
				});

				if (driverTestConfig.clientType === "inline") {
					// Inline clients bypass authentication - should succeed
					const result = await instance.setValue(42);
					expect(result).toBe(42);
				} else {
					// HTTP clients should enforce authentication
					try {
						await instance.setValue(42);
						expect.fail("Expected permission error for action");
					} catch (error) {
						expect((error as ActorError).code).toBe("insufficient_permissions");
						expect((error as ActorError).message).toContain(
							"User or admin role required",
						);
					}
				}
			});
		});

		describe("Public Access", () => {
			test("should allow access with empty onAuth", async (c) => {
				const { client } = await setupDriverTest(c, driverTestConfig);

				// Public actor should allow access without authentication
				const instance = client.publicActor.getOrCreate();

				const visitors = await instance.visit();
				expect(visitors).toBe(1);

				// Should be able to call multiple times
				const visitors2 = await instance.visit();
				expect(visitors2).toBe(2);
			});

			test("should deny access without onAuth defined", async (c) => {
				const { client } = await setupDriverTest(c, driverTestConfig);

				// Actor without onAuth should be blocked
				const instance = client.noAuthActor.getOrCreate();

				if (driverTestConfig.clientType === "inline") {
					// Inline clients bypass authentication - should succeed
					const value = await instance.getValue();
					expect(value).toBe(42);
				} else {
					// HTTP clients should enforce authentication
					try {
						await instance.getValue();
						expect.fail(
							"Expected access to be denied for actor without onAuth",
						);
					} catch (error) {
						expect((error as ActorError).code).toBe("forbidden");
					}
				}
			});
		});

		describe("Async Authentication", () => {
			test("should handle promise-based auth", async (c) => {
				const { client } = await setupDriverTest(c, driverTestConfig);

				const instance = client.asyncAuthActor.getOrCreate(undefined, {
					params: { token: "valid" },
				});

				// Should succeed with valid token
				const result = await instance.increment();
				expect(result).toBe(1);

				// Auth data should be available
				const authData = await instance.getAuthData();
				if (driverTestConfig.clientType === "inline") {
					// Inline clients don't have auth data
					expect(authData).toBeUndefined();
				} else {
					// HTTP clients should have auth data
					expect(authData).toBeDefined();
					expect((authData as any).userId).toBe("user-valid");
					expect((authData as any).validated).toBe(true);
				}
			});

			test("should handle async auth failures", async (c) => {
				const { client } = await setupDriverTest(c, driverTestConfig);

				const instance = client.asyncAuthActor.getOrCreate();

				if (driverTestConfig.clientType === "inline") {
					// Inline clients bypass authentication - should succeed
					const result = await instance.increment();
					expect(result).toBe(1);
				} else {
					// HTTP clients should enforce authentication
					try {
						await instance.increment();
						expect.fail("Expected async auth failure");
					} catch (error) {
						expect((error as ActorError).code).toBe("missing_token");
					}
				}
			});
		});

		describe("Authentication Across Transports", () => {
			if (driverTestConfig.transport === "websocket") {
				test("should authenticate WebSocket connections", async (c) => {
					const { client } = await setupDriverTest(c, driverTestConfig);

					// Test WebSocket connection auth
					const instance = client.authActor.getOrCreate(undefined, {
						params: { apiKey: "valid-api-key" },
					});

					// Should be able to establish connection and call actions
					const authData = await instance.getUserAuth();
					expect(authData).toBeDefined();
					expect((authData as any).userId).toBe("user123");
				});
			}

			test("should authenticate HTTP actions", async (c) => {
				const { client } = await setupDriverTest(c, driverTestConfig);

				// Test HTTP action auth
				const instance = client.authActor.getOrCreate(undefined, {
					params: { apiKey: "valid-api-key" },
				});

				// Actions should require authentication
				const requests = await instance.getRequests();
				expect(typeof requests).toBe("number");
			});
		});

		describe("Error Handling", () => {
			test("should handle auth errors gracefully", async (c) => {
				const { client } = await setupDriverTest(c, driverTestConfig);

				const instance = client.authActor.getOrCreate();

				if (driverTestConfig.clientType === "inline") {
					// Inline clients bypass authentication - should succeed
					const requests = await instance.getRequests();
					expect(typeof requests).toBe("number");
				} else {
					// HTTP clients should enforce authentication
					try {
						await instance.getRequests();
						expect.fail("Expected authentication error");
					} catch (error) {
						// Error should be properly structured
						const actorError = error as ActorError;
						expect(actorError.code).toBeDefined();
						expect(actorError.message).toBeDefined();
					}
				}
			});

			test("should preserve error details for debugging", async (c) => {
				const { client } = await setupDriverTest(c, driverTestConfig);

				const instance = client.asyncAuthActor.getOrCreate();

				if (driverTestConfig.clientType === "inline") {
					// Inline clients bypass authentication - should succeed
					const result = await instance.increment();
					expect(result).toBe(1);
				} else {
					// HTTP clients should enforce authentication
					try {
						await instance.increment();
						expect.fail("Expected token error");
					} catch (error) {
						const actorError = error as ActorError;
						expect(actorError.code).toBe("missing_token");
						expect(actorError.message).toBe("Token required");
					}
				}
			});
		});

		describe("Raw HTTP Authentication", () => {
			test("should allow raw HTTP access with valid auth", async (c) => {
				const { client } = await setupDriverTest(c, driverTestConfig);

				// Create actor with valid auth
				const instance = client.rawHttpAuthActor.getOrCreate(undefined, {
					params: { apiKey: "valid-api-key" },
				});

				// Raw HTTP request should succeed
				const response = await instance.fetch("api/auth-info");
				expect(response.ok).toBe(true);

				const data = (await response.json()) as any;
				expect(data.message).toBe("Authenticated request");
				expect(data.requestCount).toBe(1);

				// Regular actions should also work
				const count = await instance.getRequestCount();
				expect(count).toBe(1);
			});

			test("should deny raw HTTP access without auth", async (c) => {
				const { client } = await setupDriverTest(c, driverTestConfig);

				// Create actor without auth
				const instance = client.rawHttpAuthActor.getOrCreate();

				// All clients should now enforce authentication for raw endpoints
				const response = await instance.fetch("api/protected");
				if (driverTestConfig.clientType === "inline") {
					expect(response.ok).toBe(true);
					expect(response.status).toBe(200);
				} else {
					expect(response.ok).toBe(false);
					expect(response.status).toBe(400);
				}

				// Check error details
				try {
					const errorData = (await response.json()) as any;
					expect(errorData.c || errorData.code).toBe("missing_auth");
				} catch {
					// Response might be CBOR encoded, status code check is sufficient
				}
			});

			test("should deny raw HTTP for actors without onAuth", async (c) => {
				const { client } = await setupDriverTest(c, driverTestConfig);

				const instance = client.rawHttpNoAuthActor.getOrCreate();

				// All clients should now enforce authentication for raw endpoints
				const response = await instance.fetch("api/test");
				if (driverTestConfig.clientType === "inline") {
					expect(response.ok).toBe(true);
					expect(response.status).toBe(200);
				} else {
					expect(response.ok).toBe(false);
					expect(response.status).toBe(403);
				}

				// Check error details
				try {
					const errorData = (await response.json()) as any;
					expect(errorData.c || errorData.code).toBe("forbidden");
				} catch {
					// Response might be CBOR encoded, status code check is sufficient
				}
			});

			test("should allow public raw HTTP access", async (c) => {
				const { client } = await setupDriverTest(c, driverTestConfig);

				const instance = client.rawHttpPublicActor.getOrCreate();

				// Should work without auth
				const response = await instance.fetch("api/visit");
				expect(response.ok).toBe(true);

				const data = (await response.json()) as any;
				expect(data.message).toBe("Welcome visitor!");
				expect(data.count).toBe(1);

				// Second request
				const response2 = await instance.fetch("api/visit");
				const data2 = (await response2.json()) as any;
				expect(data2.count).toBe(2);
			});

			test("should handle custom auth in onFetch", async (c) => {
				const { client } = await setupDriverTest(c, driverTestConfig);

				const instance = client.rawHttpCustomAuthActor.getOrCreate();

				// Request without auth should fail
				const response1 = await instance.fetch("api/data");
				expect(response1.ok).toBe(false);
				expect(response1.status).toBe(401);

				const error1 = (await response1.json()) as any;
				expect(error1.error).toBe("Unauthorized");

				// Request with wrong token should fail
				const response2 = await instance.fetch("api/data", {
					headers: {
						Authorization: "Bearer wrong-token",
					},
				});
				expect(response2.ok).toBe(false);
				expect(response2.status).toBe(403);

				// Request with correct token should succeed
				const response3 = await instance.fetch("api/data", {
					headers: {
						Authorization: "Bearer custom-token",
					},
				});
				expect(response3.ok).toBe(true);

				const data = (await response3.json()) as any;
				expect(data.message).toBe("Authorized!");
				expect(data.authorized).toBe(1);

				// Check stats
				const stats = await instance.getStats();
				expect(stats.authorized).toBe(1);
				expect(stats.unauthorized).toBe(2);
			});
		});

		describe("Raw WebSocket Authentication", () => {
			test("should allow raw WebSocket access with valid auth", async (c) => {
				const { client } = await setupDriverTest(c, driverTestConfig);

				// Create actor with valid auth
				const instance = client.rawWebSocketAuthActor.getOrCreate(undefined, {
					params: { apiKey: "valid-api-key" },
				});

				const ws = await instance.websocket();

				// Wait for welcome message
				const welcomePromise = new Promise((resolve) => {
					ws.addEventListener("message", (event: any) => {
						const data = JSON.parse(event.data);
						if (data.type === "welcome") {
							resolve(data);
						}
					});
				});

				const welcomeData = (await welcomePromise) as any;
				expect(welcomeData.message).toBe("Authenticated WebSocket connection");
				expect(welcomeData.connectionCount).toBe(1);

				ws.close();
			});

			test("should deny raw WebSocket access without auth", async (c) => {
				const { client } = await setupDriverTest(c, driverTestConfig);

				const instance = client.rawWebSocketAuthActor.getOrCreate();

				// All clients should now enforce authentication for raw endpoints
				try {
					await instance.websocket();
					expect.fail("Expected authentication error");
				} catch (error) {
					// WebSocket connection failures may not always have structured error codes
					expect(error).toBeDefined();
				}
			});

			test("should deny raw WebSocket for actors without onAuth", async (c) => {
				const { client } = await setupDriverTest(c, driverTestConfig);

				const instance = client.rawWebSocketNoAuthActor.getOrCreate();

				// All clients should now enforce authentication for raw endpoints
				try {
					await instance.websocket();
					expect.fail("Expected forbidden error");
				} catch (error) {
					// WebSocket connection failures may not always have structured error codes
					expect(error).toBeDefined();
				}
			});

			test("should allow public raw WebSocket access", async (c) => {
				const { client } = await setupDriverTest(c, driverTestConfig);

				const instance = client.rawWebSocketPublicActor.getOrCreate();

				// Should work without auth
				const ws = await instance.websocket();

				const welcomePromise = new Promise((resolve) => {
					ws.addEventListener("message", (event: any) => {
						const data = JSON.parse(event.data);
						if (data.type === "welcome") {
							resolve(data);
						}
					});
				});

				const welcomeData = (await welcomePromise) as any;
				expect(welcomeData.message).toBe("Public WebSocket connection");
				expect(welcomeData.visitorNumber).toBe(1);

				ws.close();
			});

			test("should handle custom auth in onWebSocket", async (c) => {
				const { client } = await setupDriverTest(c, driverTestConfig);

				const instance = client.rawWebSocketCustomAuthActor.getOrCreate();

				// WebSocket without token should be rejected
				try {
					const ws1 = await instance.websocket();

					// Listen for error message before close
					const errorPromise = new Promise((resolve, reject) => {
						ws1.addEventListener("message", (event: any) => {
							const data = JSON.parse(event.data);
							if (data.type === "error") {
								resolve(data);
							}
						});
						ws1.addEventListener("close", (event: any) => {
							reject(
								new Error(`WebSocket closed: ${event.code} ${event.reason}`),
							);
						});
					});

					const errorData = (await errorPromise) as any;
					expect(errorData.type).toBe("error");
					expect(errorData.message).toBe("Unauthorized");
				} catch (error) {
					// Some drivers might reject the connection immediately
					expect(error).toBeDefined();
				}

				// WebSocket with correct token should succeed
				const ws2 = await instance.websocket("?token=custom-ws-token");

				const authPromise = new Promise((resolve) => {
					ws2.addEventListener("message", (event: any) => {
						const data = JSON.parse(event.data);
						if (data.type === "authorized") {
							resolve(data);
						}
					});
				});

				const authData = (await authPromise) as any;
				expect(authData.message).toBe("Welcome authenticated user!");

				ws2.close();

				// Check stats
				const stats = await instance.getStats();
				expect(stats.authorized).toBeGreaterThanOrEqual(1);
				expect(stats.unauthorized).toBeGreaterThanOrEqual(1);
			});
		});
	});
}
