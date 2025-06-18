import { describe, it, expect, expectTypeOf } from "vitest";
import { WorkerDefinition, type WorkerContextOf } from "@/worker/definition";
import type { WorkerContext } from "@/worker/context";

describe("WorkerDefinition", () => {
	describe("WorkerContextOf type utility", () => {
		it("should correctly extract the context type from an WorkerDefinition", () => {
			// Define some simple types for testing
			interface TestState {
				counter: number;
			}

			interface TestConnParams {
				clientId: string;
			}

			interface TestConnState {
				lastSeen: number;
			}

			interface TestVars {
				foo: string;
			}

			interface TestInput {
				bar: string;
			}

			interface TestAuthData {
				baz: string;
			}

			interface TestDatabase {
				onMigrate: () => void;
				client: object;
			}

			// For testing type utilities, we don't need a real worker instance
			// We just need a properly typed WorkerDefinition to check against
			type TestActions = Record<never, never>;
			const dummyDefinition = {} as WorkerDefinition<
				TestState,
				TestConnParams,
				TestConnState,
				TestVars,
				TestInput,
				TestAuthData,
				TestDatabase,
				TestActions
			>;

			// Use expectTypeOf to verify our type utility works correctly
			expectTypeOf<WorkerContextOf<typeof dummyDefinition>>().toEqualTypeOf<
				WorkerContext<
					TestState,
					TestConnParams,
					TestConnState,
					TestVars,
					TestInput,
					TestAuthData,
					TestDatabase
				>
			>();

			// Make sure that different types are not compatible
			interface DifferentState {
				value: string;
			}

			expectTypeOf<WorkerContextOf<typeof dummyDefinition>>().not.toEqualTypeOf<
				WorkerContext<
					DifferentState,
					TestConnParams,
					TestConnState,
					TestVars,
					TestInput,
					TestAuthData,
					TestDatabase
				>
			>();
		});
	});
});
