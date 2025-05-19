import * as wsToClient from "@/actor/protocol/message/to-client";
import * as wsToServer from "@/actor/protocol/message/to-server";
import type { ActorInstance, AnyActorInstance } from "../../instance";
import type { Conn } from "../../connection";
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
		value instanceof SharedArrayBuffer ||
		value instanceof Uint8Array
	) {
		return value.byteLength;
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

export interface ProcessMessageHandler<S, CP, CS, V> {
	onExecuteRpc?: (
		ctx: ActionContext<S, CP, CS, V>,
		name: string,
		args: unknown[],
	) => Promise<unknown>;
	onSubscribe?: (eventName: string, conn: Conn<S, CP, CS, V>) => Promise<void>;
	onUnsubscribe?: (
		eventName: string,
		conn: Conn<S, CP, CS, V>,
	) => Promise<void>;
}

export async function processMessage<S, CP, CS, V>(
	message: wsToServer.ToServer,
	actor: ActorInstance<S, CP, CS, V>,
	conn: Conn<S, CP, CS, V>,
	handler: ProcessMessageHandler<S, CP, CS, V>,
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

			logger().debug("processing RPC request", {
				id,
				name,
				argsCount: args.length,
			});

			const ctx = new ActionContext<S, CP, CS, V>(actor.actorContext, conn);

			// Process the RPC request and wait for the result
			// This will wait for async actions to complete
			const output = await handler.onExecuteRpc(ctx, name, args);

			logger().debug("sending RPC response", {
				id,
				name,
				outputType: typeof output,
				isPromise: output instanceof Promise,
			});

			// Send the response back to the client
			conn._sendMessage(
				new CachedSerializer<wsToClient.ToClient>({
					b: {
						rr: {
							i: id,
							o: output,
						},
					},
				}),
			);

			logger().debug("RPC response sent", { id, name });
		} else if ("sr" in message.b) {
			// Subscription request

			if (
				handler.onSubscribe === undefined ||
				handler.onUnsubscribe === undefined
			) {
				throw new errors.Unsupported("Subscriptions");
			}

			const { e: eventName, s: subscribe } = message.b.sr;
			logger().debug("processing subscription request", {
				eventName,
				subscribe,
			});

			if (subscribe) {
				await handler.onSubscribe(eventName, conn);
			} else {
				await handler.onUnsubscribe(eventName, conn);
			}

			logger().debug("subscription request completed", {
				eventName,
				subscribe,
			});
		} else {
			assertUnreachable(message.b);
		}
	} catch (error) {
		const { code, message, metadata } = deconstructError(error, logger(), {
			connectionId: conn.id,
			rpcId,
			rpcName,
		});

		logger().debug("sending error response", {
			rpcId,
			rpcName,
			code,
			message,
		});

		// Build response
		conn._sendMessage(
			new CachedSerializer<wsToClient.ToClient>({
				b: {
					e: {
						c: code,
						m: message,
						md: metadata,
						ri: rpcId,
					},
				},
			}),
		);

		logger().debug("error response sent", { rpcId, rpcName });
	}
}
