import type { ActorsRequest, ActorsResponse } from "@/manager/protocol/mod";
import { HonoRequest } from "hono";

export interface ManagerDriver {
	queryActor(opts: {
		body: ActorsRequest;
		request: HonoRequest;
	}): Promise<ActorsResponse>;
}
