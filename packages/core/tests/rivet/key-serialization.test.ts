// import { describe, test, expect } from "vitest";
// import { serializeKeyForTag, deserializeKeyFromTag, EMPTY_KEY, KEY_SEPARATOR } from "../src/util";
//
// describe("Key serialization and deserialization", () => {
//   // Test serialization
//   describe("serializeKeyForTag", () => {
//     test("serializes empty key array", () => {
//       expect(serializeKeyForTag([])).toBe(EMPTY_KEY);
//     });
//
//     test("serializes single key", () => {
//       expect(serializeKeyForTag(["test"])).toBe("test");
//     });
//
//     test("serializes multiple keys", () => {
//       expect(serializeKeyForTag(["a", "b", "c"])).toBe(`a${KEY_SEPARATOR}b${KEY_SEPARATOR}c`);
//     });
//
//     test("escapes commas in keys", () => {
//       expect(serializeKeyForTag(["a,b"])).toBe("a\\,b");
//       expect(serializeKeyForTag(["a,b", "c"])).toBe(`a\\,b${KEY_SEPARATOR}c`);
//     });
//
//     test("escapes empty key marker in keys", () => {
//       expect(serializeKeyForTag([EMPTY_KEY])).toBe(`\\${EMPTY_KEY}`);
//     });
//
//     test("handles complex keys", () => {
//       expect(serializeKeyForTag(["a,b", EMPTY_KEY, "c,d"])).toBe(`a\\,b${KEY_SEPARATOR}\\${EMPTY_KEY}${KEY_SEPARATOR}c\\,d`);
//     });
//   });
//
//   // Test deserialization
//   describe("deserializeKeyFromTag", () => {
//     test("deserializes empty string", () => {
//       expect(deserializeKeyFromTag("")).toEqual([]);
//     });
//
//     test("deserializes undefined/null", () => {
//       expect(deserializeKeyFromTag(undefined as unknown as string)).toEqual([]);
//       expect(deserializeKeyFromTag(null as unknown as string)).toEqual([]);
//     });
//
//     test("deserializes empty key marker", () => {
//       expect(deserializeKeyFromTag(EMPTY_KEY)).toEqual([]);
//     });
//
//     test("deserializes single key", () => {
//       expect(deserializeKeyFromTag("test")).toEqual(["test"]);
//     });
//
//     test("deserializes multiple keys", () => {
//       expect(deserializeKeyFromTag(`a${KEY_SEPARATOR}b${KEY_SEPARATOR}c`)).toEqual(["a", "b", "c"]);
//     });
//
//     test("deserializes keys with escaped commas", () => {
//       expect(deserializeKeyFromTag("a\\,b")).toEqual(["a,b"]);
//       expect(deserializeKeyFromTag(`a\\,b${KEY_SEPARATOR}c`)).toEqual(["a,b", "c"]);
//     });
//
//     test("deserializes keys with escaped empty key marker", () => {
//       expect(deserializeKeyFromTag(`\\${EMPTY_KEY}`)).toEqual([EMPTY_KEY]);
//     });
//
//     test("deserializes complex keys", () => {
//       expect(deserializeKeyFromTag(`a\\,b${KEY_SEPARATOR}\\${EMPTY_KEY}${KEY_SEPARATOR}c\\,d`)).toEqual(["a,b", EMPTY_KEY, "c,d"]);
//     });
//   });
//
//   // Test roundtrip
//   describe("roundtrip", () => {
//     const testKeys = [
//       [],
//       ["test"],
//       ["a", "b", "c"],
//       ["a,b", "c"],
//       [EMPTY_KEY],
//       ["a,b", EMPTY_KEY, "c,d"],
//       ["special\\chars", "more:complex,keys", "final key"]
//     ];
//
//     testKeys.forEach(key => {
//       test(`roundtrip: ${JSON.stringify(key)}`, () => {
//         const serialized = serializeKeyForTag(key);
//         const deserialized = deserializeKeyFromTag(serialized);
//         expect(deserialized).toEqual(key);
//       });
//     });
//
//     test("handles all test cases in a large batch", () => {
//       for (const key of testKeys) {
//         const serialized = serializeKeyForTag(key);
//         const deserialized = deserializeKeyFromTag(serialized);
//         expect(deserialized).toEqual(key);
//       }
//     });
//   });
//
//   // Test edge cases
//   describe("edge cases", () => {
//     test("handles backslash at the end", () => {
//       const key = ["abc\\"];
//       const serialized = serializeKeyForTag(key);
//       const deserialized = deserializeKeyFromTag(serialized);
//       expect(deserialized).toEqual(key);
//     });
//
//     test("handles backslashes in middle of string", () => {
//       const keys = [
//         ["abc\\def"],
//         ["abc\\\\def"],
//         ["path\\to\\file"]
//       ];
//
//       for (const key of keys) {
//         const serialized = serializeKeyForTag(key);
//         const deserialized = deserializeKeyFromTag(serialized);
//         expect(deserialized).toEqual(key);
//       }
//     });
//
//     test("handles commas at the end of strings", () => {
//       const serialized = serializeKeyForTag(["abc\\,"]);
//       expect(deserializeKeyFromTag(serialized)).toEqual(["abc\\,"]);
//     });
//
//     test("handles mixed backslashes and commas", () => {
//       const keys = [
//         ["path\\to\\file,dir"],
//         ["file\\with,comma"],
//         ["path\\to\\file", "with,comma"]
//       ];
//
//       for (const key of keys) {
//         const serialized = serializeKeyForTag(key);
//         const deserialized = deserializeKeyFromTag(serialized);
//         expect(deserialized).toEqual(key);
//       }
//     });
//
//     test("handles multiple consecutive commas", () => {
//       const key = ["a,,b"];
//       const serialized = serializeKeyForTag(key);
//       const deserialized = deserializeKeyFromTag(serialized);
//       expect(deserialized).toEqual(key);
//     });
//
//     test("handles special characters", () => {
//       const key = ["a💻b", "c🔑d"];
//       const serialized = serializeKeyForTag(key);
//       const deserialized = deserializeKeyFromTag(serialized);
//       expect(deserialized).toEqual(key);
//     });
//
//     test("handles escaped commas immediately after separator", () => {
//       const key = ["abc", ",def"];
//       const serialized = serializeKeyForTag(key);
//       expect(serialized).toBe(`abc${KEY_SEPARATOR}\\,def`);
//       expect(deserializeKeyFromTag(serialized)).toEqual(key);
//     });
//   });
//
//   // Test exact key matching
//   describe("exact key matching", () => {
//     test("differentiates [a,b] from [a,b,c]", () => {
//       const key1 = ["a", "b"];
//       const key2 = ["a", "b", "c"];
//
//       const serialized1 = serializeKeyForTag(key1);
//       const serialized2 = serializeKeyForTag(key2);
//
//       expect(serialized1).not.toBe(serialized2);
//     });
//
//     test("differentiates [a,b] from [a]", () => {
//       const key1 = ["a", "b"];
//       const key2 = ["a"];
//
//       const serialized1 = serializeKeyForTag(key1);
//       const serialized2 = serializeKeyForTag(key2);
//
//       expect(serialized1).not.toBe(serialized2);
//     });
//
//     test("differentiates [a,b] from [a:b]", () => {
//       const key1 = ["a,b"];
//       const key2 = ["a", "b"];
//
//       const serialized1 = serializeKeyForTag(key1);
//       const serialized2 = serializeKeyForTag(key2);
//
//       expect(serialized1).not.toBe(serialized2);
//       expect(deserializeKeyFromTag(serialized1)).toEqual(key1);
//       expect(deserializeKeyFromTag(serialized2)).toEqual(key2);
//     });
//   });
// });
