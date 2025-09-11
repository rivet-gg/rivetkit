import { describe, expect, it } from "vitest";
import { createVersionedDataHandler, type MigrationFn } from "../src/index";

interface V1Data {
	name: string;
}

interface V2Data {
	name: string;
	age: number;
}

interface V3Data {
	firstName: string;
	lastName: string;
	age: number;
}

describe("VersionedDataHandler", () => {
	it("should encode and decode current version data", () => {
		const HANDLER = createVersionedDataHandler<V1Data>({
			currentVersion: 1,
			migrations: new Map(),
			serializeVersion: (data) =>
				new TextEncoder().encode(JSON.stringify(data)),
			deserializeVersion: (bytes) =>
				JSON.parse(new TextDecoder().decode(bytes)),
		});

		const original: V1Data = { name: "John" };
		const encoded = HANDLER.serializeWithEmbeddedVersion(original);
		const decoded = HANDLER.deserializeWithEmbeddedVersion(encoded);

		expect(decoded).toEqual(original);
	});

	it("should migrate from v1 to v2", () => {
		const v1to2: MigrationFn<V1Data, V2Data> = (data) => ({
			name: data.name,
			age: 0,
		});

		const HANDLER = createVersionedDataHandler<V2Data>({
			currentVersion: 2,
			migrations: new Map([[1, v1to2]]),
			serializeVersion: (data) =>
				new TextEncoder().encode(JSON.stringify(data)),
			deserializeVersion: (bytes) =>
				JSON.parse(new TextDecoder().decode(bytes)),
		});

		const V1_HANDLER = createVersionedDataHandler<V1Data>({
			currentVersion: 1,
			migrations: new Map(),
			serializeVersion: (data) =>
				new TextEncoder().encode(JSON.stringify(data)),
			deserializeVersion: (bytes) =>
				JSON.parse(new TextDecoder().decode(bytes)),
		});

		const v1Data: V1Data = { name: "John" };
		const v1Encoded = V1_HANDLER.serializeWithEmbeddedVersion(v1Data);

		const v2Decoded = HANDLER.deserializeWithEmbeddedVersion(v1Encoded);
		expect(v2Decoded).toEqual({ name: "John", age: 0 });
	});

	it("should migrate through multiple versions", () => {
		const v1to2: MigrationFn<V1Data, V2Data> = (data) => ({
			name: data.name,
			age: 25,
		});

		const v2to3: MigrationFn<V2Data, V3Data> = (data) => {
			const [firstName, ...lastParts] = data.name.split(" ");
			return {
				firstName,
				lastName: lastParts.join(" ") || "",
				age: data.age,
			};
		};

		const HANDLER = createVersionedDataHandler<V3Data>({
			currentVersion: 3,
			migrations: new Map<number, MigrationFn<any, any>>([
				[1, v1to2],
				[2, v2to3],
			]),
			serializeVersion: (data) =>
				new TextEncoder().encode(JSON.stringify(data)),
			deserializeVersion: (bytes) =>
				JSON.parse(new TextDecoder().decode(bytes)),
		});

		const V1_HANDLER = createVersionedDataHandler<V1Data>({
			currentVersion: 1,
			migrations: new Map(),
			serializeVersion: (data) =>
				new TextEncoder().encode(JSON.stringify(data)),
			deserializeVersion: (bytes) =>
				JSON.parse(new TextDecoder().decode(bytes)),
		});

		const v1Data: V1Data = { name: "John Doe" };
		const v1Encoded = V1_HANDLER.serializeWithEmbeddedVersion(v1Data);

		const v3Decoded = HANDLER.deserializeWithEmbeddedVersion(v1Encoded);
		expect(v3Decoded).toEqual({
			firstName: "John",
			lastName: "Doe",
			age: 25,
		});
	});

	it("should throw error for future version", () => {
		const HANDLER = createVersionedDataHandler<V1Data>({
			currentVersion: 1,
			migrations: new Map(),
			serializeVersion: (data) =>
				new TextEncoder().encode(JSON.stringify(data)),
			deserializeVersion: (bytes) =>
				JSON.parse(new TextDecoder().decode(bytes)),
		});

		const futureVersionBytes = new Uint8Array([
			2,
			0,
			0,
			0,
			...new TextEncoder().encode('{"name":"test"}'),
		]);

		expect(() =>
			HANDLER.deserializeWithEmbeddedVersion(futureVersionBytes),
		).toThrow("Cannot decode data from version 2, current version is 1");
	});

	it("should throw error for missing migration", () => {
		const HANDLER = createVersionedDataHandler<V3Data>({
			currentVersion: 3,
			migrations: new Map([[2, (data: any) => data]]),
			serializeVersion: (data) =>
				new TextEncoder().encode(JSON.stringify(data)),
			deserializeVersion: (bytes) =>
				JSON.parse(new TextDecoder().decode(bytes)),
		});

		const v1Bytes = new Uint8Array([
			1,
			0,
			0,
			0,
			...new TextEncoder().encode('{"name":"test"}'),
		]);

		expect(() => HANDLER.deserializeWithEmbeddedVersion(v1Bytes)).toThrow(
			"No migration found from version 1 to 2",
		);
	});

	it("should handle binary data correctly", () => {
		const HANDLER = createVersionedDataHandler<Uint8Array>({
			currentVersion: 1,
			migrations: new Map(),
			serializeVersion: (data) => data,
			deserializeVersion: (bytes) => bytes,
		});

		const original = new Uint8Array([1, 2, 3, 4, 5]);
		const encoded = HANDLER.serializeWithEmbeddedVersion(original);
		const decoded = HANDLER.deserializeWithEmbeddedVersion(encoded);

		expect(decoded).toEqual(original);
	});
});
