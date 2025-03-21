//import { describe, it, expect, expectTypeOf } from "vitest";
//import { ActorDefinition, type ActorContextOf } from "../src/actor/definition";
//import type { ActorContext } from "../src/actor/context";
//
//describe("ActorDefinition", () => {
//	describe("ActorContextOf type utility", () => {
//		it("should correctly extract the context type from an ActorDefinition", () => {
//			// Define some simple types for testing
//			interface TestState {
//				counter: number;
//			}
//
//			interface TestConnParams {
//				clientId: string;
//			}
//
//			interface TestConnState {
//				lastSeen: number;
//			}
//
//			interface TestVars {
//				foo: string;
//			}
//
//			// For testing type utilities, we don't need a real actor instance
//			// We just need a properly typed ActorDefinition to check against
//			type TestActions = Record<never, never>;
//			const dummyDefinition = {} as ActorDefinition<
//				TestState,
//				TestConnParams,
//				TestConnState,
//				TestVars,
//				TestActions
//			>;
//
//			// Use expectTypeOf to verify our type utility works correctly
//			expectTypeOf<ActorContextOf<typeof dummyDefinition>>().toEqualTypeOf<
//				ActorContext<TestState, TestConnParams, TestConnState, TestVars>
//			>();
//
//			// Make sure that different types are not compatible
//			interface DifferentState {
//				value: string;
//			}
//
//			expectTypeOf<ActorContextOf<typeof dummyDefinition>>().not.toEqualTypeOf<
//				ActorContext<DifferentState, TestConnParams, TestConnState, TestVars>
//			>();
//		});
//	});
//});
