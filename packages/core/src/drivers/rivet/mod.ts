import type { DriverConfig } from "@/registry/run-config";
import { RivetManagerDriver } from "./manager-driver";
import { getRivetClientConfig } from "./rivet-client";

export function createRivetManagerDriver(): DriverConfig {
	const clientConfig = getRivetClientConfig();
	return {
		topology: "partition",
		manager: new RivetManagerDriver(clientConfig),
		// We don't have access to `ActorContext`, so we can't construct this
		actor: undefined as any,
	};
}

export { createActorHandler } from  "./actor";
