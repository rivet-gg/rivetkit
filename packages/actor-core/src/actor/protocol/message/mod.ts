import * as wsToClient from "@/actor/protocol/message/to_client";
import * as wsToServer from "@/actor/protocol/message/to_server";
import type { AnyActor } from "../../runtime/actor";
import type { Connection } from "../../runtime/connection";
import * as errors from "../../errors";
import { logger } from "../../runtime/log";
import { Rpc } from "../../runtime/rpc";
import { assertUnreachable } from "../../runtime/utils";
import { z } from "zod";
import {
	deserialize,
	Encoding,
	InputData,
	CachedSerializer,
} from "@/actor/protocol/serde";
import { deconstructError } from "@/common/utils";

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

export interface ProcessMessageHandler<A extends AnyActor> {
	onExecuteRpc?: (
		ctx: Rpc<A>,
		name: string,
		args: unknown[],
	) => Promise<unknown>;
	onSubscribe?: (eventName: string, conn: Connection<A>) => Promise<void>;
	onUnsubscribe?: (eventName: string, conn: Connection<A>) => Promise<void>;
}

export async function processMessage<A extends AnyActor>(
	message: wsToServer.ToServer,
	conn: Connection<A>,
	handler: ProcessMessageHandler<A>,
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

			const ctx = new Rpc<A>(conn);
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
