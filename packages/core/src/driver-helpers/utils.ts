import * as cbor from "cbor-x";
import type { PersistedActor } from "@/actor/persisted";

export function serializeEmptyPersistData(
	input: unknown | undefined,
): Uint8Array {
	const persistData: PersistedActor<any, any, any, any> = {
		i: input,
		hi: false,
		s: undefined,
		c: [],
		e: [],
	};
	return cbor.encode(persistData);
}
