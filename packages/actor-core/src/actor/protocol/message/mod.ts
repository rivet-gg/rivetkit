import * as wsToClient from "@/actor/protocol/message/to-client";
import * as wsToServer from "@/actor/protocol/message/to-server";
import type { ActorInstance, AnyActorInstance } from "../../instance";
import type { Connection } from "../../connection";
import * as errors from "../../errors";
import { logger } from "../../log";
import { ActionContext } from "../../action";
import { assertUnreachable } from "../../utils";
import { z } from "zod";
import {
	deserialize,
	Encoding,
	InputData,
	CachedSerializer,
} from "@/actor/protocol/serde";
import { deconstructError } from "@/common/utils";
import { Actions } from "@/actor/config";

export const TransportSchema = z.enum(["websocket", "sse"]);

/**
 * Transport mechanism used to communicate between client & actor.
 */
export type Transport = z.infer<typeof TransportSchema>;

interface MessageEventOpts {
	encoding: Encoding;
	maxIncomingMessageSize: number;
}

function getValueLength(value: InputData): number {
	if (typeof value === "string") {
		return value.length;
	} else if (value instanceof Blob) {
		return value.size;
	} else if (
		value instanceof ArrayBuffer ||
		value instanceof SharedArrayBuffer
	) {
		return value.byteLength;
	} else if (Buffer.isBuffer(value)) {
		return value.length;
	} else {
		assertUnreachable(value);
	}
}

export async function parseMessage(
	value: InputData,
	opts: MessageEventOpts,
): Promise<wsToServer.ToServer> {
	// Validate value length
	const length = getValueLength(value);
	if (length > opts.maxIncomingMessageSize) {
		throw new errors.MessageTooLong();
	}

	// Parse & validate message
	const deserializedValue = await deserialize(value, opts.encoding);
	const {
		data: message,
		success,
		error,
	} = wsToServer.ToServerSchema.safeParse(deserializedValue);
	if (!success) {
		throw new errors.MalformedMessage(error);
	}

	return message;
}

export interface ProcessMessageHandler<S, CP, CS> {
	onExecuteRpc?: (
		ctx: ActionContext<S, CP, CS>,
		name: string,
		args: unknown[],
	) => Promise<unknown>;
	onSubscribe?: (eventName: string, conn: Connection<S, CP, CS>) => Promise<void>;
	onUnsubscribe?: (eventName: string, conn: Connection<S, CP, CS>) => Promise<void>;
}

export async function processMessage<S, CP, CS>(
	message: wsToServer.ToServer,
	actor: ActorInstance<S, CP, CS>,
	conn: Connection<S, CP, CS>,
	handler: ProcessMessageHandler<S, CP, CS>,
) {
	let rpcId: number | undefined;
	let rpcName: string | undefined;

	try {
		if ("rr" in message.b) {
			// RPC request

			if (handler.onExecuteRpc === undefined) {
				throw new errors.Unsupported("RPC");
			}

			const { i: id, n: name, a: args = [] } = message.b.rr;

			rpcId = id;
			rpcName = name;

			const ctx = new ActionContext<S, CP, CS>(actor.actorContext, conn);
			const output = await handler.onExecuteRpc(ctx, name, args);

			conn._sendMessage(
				new CachedSerializer<wsToClient.ToClient>({
					b: {
						ro: {
							i: id,
							o: output,
						},
					},
				}),
			);
		} else if ("sr" in message.b) {
			// Subscription request

			if (
				handler.onSubscribe === undefined ||
				handler.onUnsubscribe === undefined
			) {
				throw new errors.Unsupported("Subscriptions");
			}

			const { e: eventName, s: subscribe } = message.b.sr;

			if (subscribe) {
				await handler.onSubscribe(eventName, conn);
			} else {
				await handler.onUnsubscribe(eventName, conn);
			}
		} else {
			assertUnreachable(message.b);
		}
	} catch (error) {
		const { code, message, metadata } = deconstructError(error, logger(), {
			connectionId: conn.id,
			rpcId,
			rpcName,
		});

		// Build response
		if (rpcId !== undefined) {
			conn._sendMessage(
				new CachedSerializer({
					b: {
						re: {
							i: rpcId,
							c: code,
							m: message,
							md: metadata,
						},
					},
				}),
			);
		} else {
			conn._sendMessage(
				new CachedSerializer({
					b: {
						er: {
							c: code,
							m: message,
							md: metadata,
						},
					},
				}),
			);
		}
	}
}
