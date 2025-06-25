import { describe, test, expect } from "vitest";
import type { DriverTestConfig } from "../mod";
import { setupDriverTest } from "../utils";
import { ActorError } from "@/client/errors";

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
					expect(authData).toEqual({ userId: "user123", token: "valid-api-key" });
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
						expect.fail("Expected access to be denied for actor without onAuth");
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
	});
}
