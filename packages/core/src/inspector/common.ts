import type { ConnId } from "@/actor/connection";
import { deconstructError, noopNext, safeStringify } from "@/common/utils";
import type { HonoRequest, Handler } from "hono";
import type { WSContext, WSEvents } from "hono/ws";
import type { Logger } from "@/common/log";
import type { ManagerDriver } from "@/manager/driver";
import type { ManagerInspectorConnection } from "./manager";
import type { UpgradeWebSocket } from "@/utils";
import invariant from "invariant";

interface ConnectInspectorOpts {
	req: HonoRequest;
}

export interface ConnectInspectorOutput<MsgSchema> {
	onOpen: (ws: WSContext) => Promise<void>;
	onMessage: (message: MsgSchema) => Promise<void>;
	onClose: () => Promise<void>;
}

export type InspectorConnHandler<MsgSchema> = (
	opts: ConnectInspectorOpts,
) => Promise<ConnectInspectorOutput<MsgSchema>>;

/**
 * Represents a connection to a actor.
 * @internal
 */
export class InspectorConnection<MsgSchema> {
	constructor(
		public readonly id: string,
		private readonly ws: WSContext,
	) {}

	send(message: MsgSchema) {
		try {
			const serialized = safeStringify(message, 128 * 1024 * 1024);
			return this.ws.send(serialized);
		} catch {
			return this.ws.send(
				JSON.stringify({
					type: "error",
					message: "Failed to serialize message due to size constraints.",
				}),
			);
		}
	}
}
