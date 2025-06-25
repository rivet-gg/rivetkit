import { describe, expect, test, vi } from "vitest";
import type { DriverTestConfig } from "../mod";
import { setupDriverTest } from "../utils";

export function runActorConnStateTests(driverTestConfig: DriverTestConfig) {
	describe("Actor Connection State Tests", () => {
		describe("Connection State Initialization", () => {
			test("should retrieve connection state", async (c) => {
				const { client } = await setupDriverTest(c, driverTestConfig);

				// Connect to the actor
				const connection = client.connStateActor.getOrCreate().connect();

				// Get the connection state
				const connState = await connection.getConnectionState();

				// Verify the connection state structure
				expect(connState.id).toBeDefined();
				expect(connState.username).toBeDefined();
				expect(connState.role).toBeDefined();
				expect(connState.counter).toBeDefined();
				expect(connState.createdAt).toBeDefined();

				// Clean up
				await connection.dispose();
			});

			test("should initialize connection state with custom parameters", async (c) => {
				const { client } = await setupDriverTest(c, driverTestConfig);

				// Connect with custom parameters
				const connection = client.connStateActor
					.getOrCreate([], {
						params: {
							username: "testuser",
							role: "admin",
						},
					})
					.connect();

				// Get the connection state
				const connState = await connection.getConnectionState();

				// Verify the connection state was initialized with custom values
				expect(connState.username).toBe("testuser");
				expect(connState.role).toBe("admin");

				// Clean up
				await connection.dispose();
			});
		});

		describe("Connection State Management", () => {
			test("should maintain unique state for each connection", async (c) => {
				const { client } = await setupDriverTest(c, driverTestConfig);

				// Create multiple connections
				const conn1 = client.connStateActor
					.getOrCreate([], {
						params: { username: "user1" },
					})
					.connect();

				const conn2 = client.connStateActor
					.getOrCreate([], {
						params: { username: "user2" },
					})
					.connect();

				// Update connection state for each connection
				await conn1.incrementConnCounter(5);
				await conn2.incrementConnCounter(10);

				// Get state for each connection
				const state1 = await conn1.getConnectionState();
				const state2 = await conn2.getConnectionState();

				// Verify states are separate
				expect(state1.counter).toBe(5);
				expect(state2.counter).toBe(10);
				expect(state1.username).toBe("user1");
				expect(state2.username).toBe("user2");

				// Clean up
				await conn1.dispose();
				await conn2.dispose();
			});

			test("should track connections in shared state", async (c) => {
				const { client } = await setupDriverTest(c, driverTestConfig);

				// Create two connections
				const handle = client.connStateActor.getOrCreate();
				const conn1 = handle.connect();
				const conn2 = handle.connect();

				// Get state1 for reference
				const state1 = await conn1.getConnectionState();

				// Get connection IDs tracked by the actor
				const connectionIds = await conn1.getConnectionIds();

				// There should be at least 2 connections tracked
				expect(connectionIds.length).toBeGreaterThanOrEqual(2);

				// Should include the ID of the first connection
				expect(connectionIds).toContain(state1.id);

				// Clean up
				await conn1.dispose();
				await conn2.dispose();
			});

			test("should identify different connections in the same actor", async (c) => {
				const { client } = await setupDriverTest(c, driverTestConfig);

				// Create two connections to the same actor
				const handle = client.connStateActor.getOrCreate();
				const conn1 = handle.connect();
				const conn2 = handle.connect();

				// Get all connection states
				const allStates = await conn1.getAllConnectionStates();

				// Should have at least 2 states
				expect(allStates.length).toBeGreaterThanOrEqual(2);

				// IDs should be unique
				const ids = allStates.map((state) => state.id);
				const uniqueIds = [...new Set(ids)];
				expect(uniqueIds.length).toBe(ids.length);

				// Clean up
				await conn1.dispose();
				await conn2.dispose();
			});
		});

		describe("Connection Lifecycle", () => {
			test("should track connection and disconnection events", async (c) => {
				const { client } = await setupDriverTest(c, driverTestConfig);

				// Create a connection
				const handle = client.connStateActor.getOrCreate();
				const conn = handle.connect();

				// Get the connection state
				const connState = await conn.getConnectionState();

				// Verify the connection is tracked
				const connectionIds = await conn.getConnectionIds();
				expect(connectionIds).toContain(connState.id);

				// Initial disconnection count
				const initialDisconnections = await conn.getDisconnectionCount();

				// Dispose the connection
				await conn.dispose();

				// Create a new connection to check the disconnection count
				const newConn = handle.connect();

				// Verify disconnection was tracked
				await vi.waitFor(async () => {
					const newDisconnections = await newConn.getDisconnectionCount();

					expect(newDisconnections).toBeGreaterThan(initialDisconnections);
				});

				// Clean up
				await newConn.dispose();
			});

			test("should update connection state", async (c) => {
				const { client } = await setupDriverTest(c, driverTestConfig);

				// Create a connection
				const conn = client.connStateActor.getOrCreate().connect();

				// Get the initial state
				const initialState = await conn.getConnectionState();
				expect(initialState.username).toBe("anonymous");

				// Update the connection state
				const updatedState = await conn.updateConnection({
					username: "newname",
					role: "moderator",
				});

				// Verify the state was updated
				expect(updatedState.username).toBe("newname");
				expect(updatedState.role).toBe("moderator");

				// Get the state again to verify persistence
				const latestState = await conn.getConnectionState();
				expect(latestState.username).toBe("newname");
				expect(latestState.role).toBe("moderator");

				// Clean up
				await conn.dispose();
			});
		});

		describe("Connection Communication", () => {
			test("should send messages to specific connections", async (c) => {
				const { client } = await setupDriverTest(c, driverTestConfig);

				// Create two connections
				const handle = client.connStateActor.getOrCreate();
				const conn1 = handle.connect();
				const conn2 = handle.connect();

				// Get connection states
				const state1 = await conn1.getConnectionState();
				const state2 = await conn2.getConnectionState();

				// Set up event listener on second connection
				const receivedMessages: any[] = [];
				conn2.on("directMessage", (data) => {
					receivedMessages.push(data);
				});

				// Send message from first connection to second
				const success = await conn1.sendToConnection(
					state2.id,
					"Hello from conn1",
				);
				expect(success).toBe(true);

				// Verify message was received
				expect(receivedMessages.length).toBe(1);
				expect(receivedMessages[0].from).toBe(state1.id);
				expect(receivedMessages[0].message).toBe("Hello from conn1");

				// Clean up
				await conn1.dispose();
				await conn2.dispose();
			});
		});
	});
}
