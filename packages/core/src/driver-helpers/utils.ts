import { PersistedActor } from "@/actor/persisted";
import * as cbor from "cbor-x";

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
