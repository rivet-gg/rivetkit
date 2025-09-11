import * as cbor from "cbor-x";
import { z } from "zod";
import type { AnyDatabaseProvider } from "@/actor/database";
import * as errors from "@/actor/errors";
import {
	CachedSerializer,
	type Encoding,
	type InputData,
} from "@/actor/protocol/serde";
import { deconstructError } from "@/common/utils";
import type * as protocol from "@/schemas/client-protocol/mod";
import {
	TO_CLIENT_VERSIONED,
	TO_SERVER_VERSIONED,
} from "@/schemas/client-protocol/versioned";
import { deserializeWithEncoding } from "@/serde";
import { assertUnreachable, bufferToArrayBuffer } from "../../utils";
import { ActionContext } from "../action";
import type { Conn } from "../connection";
import type { ActorInstance } from "../instance";
import { logger } from "../log";

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

export async function inputDataToBuffer(
	data: InputData,
): Promise<Uint8Array | string> {
	if (typeof data === "string") {
		return data;
	} else if (data instanceof Blob) {
		const arrayBuffer = await data.arrayBuffer();
		return new Uint8Array(arrayBuffer);
	} else if (data instanceof Uint8Array) {
		return data;
	} else if (data instanceof ArrayBuffer || data instanceof SharedArrayBuffer) {
		return new Uint8Array(data);
	} else {
		throw new errors.MalformedMessage();
	}
}

export async function parseMessage(
	value: InputData,
	opts: MessageEventOpts,
): Promise<protocol.ToServer> {
	// Validate value length
	const length = getValueLength(value);
	if (length > opts.maxIncomingMessageSize) {
		throw new errors.MessageTooLong();
	}

	// Parse & validate message
	const buffer = await inputDataToBuffer(value);
	return deserializeWithEncoding(opts.encoding, buffer, TO_SERVER_VERSIONED);
}

export interface ProcessMessageHandler<
	S,
	CP,
	CS,
	V,
	I,
	AD,
	DB extends AnyDatabaseProvider,
> {
	onExecuteAction?: (
		ctx: ActionContext<S, CP, CS, V, I, AD, DB>,
		name: string,
		args: unknown[],
	) => Promise<unknown>;
	onSubscribe?: (
		eventName: string,
		conn: Conn<S, CP, CS, V, I, AD, DB>,
	) => Promise<void>;
	onUnsubscribe?: (
		eventName: string,
		conn: Conn<S, CP, CS, V, I, AD, DB>,
	) => Promise<void>;
}

export async function processMessage<
	S,
	CP,
	CS,
	V,
	I,
	AD,
	DB extends AnyDatabaseProvider,
>(
	message: protocol.ToServer,
	actor: ActorInstance<S, CP, CS, V, I, AD, DB>,
	conn: Conn<S, CP, CS, V, I, AD, DB>,
	handler: ProcessMessageHandler<S, CP, CS, V, I, AD, DB>,
) {
	let actionId: bigint | undefined;
	let actionName: string | undefined;

	try {
		if (message.body.tag === "ActionRequest") {
			// Action request

			if (handler.onExecuteAction === undefined) {
				throw new errors.Unsupported("Action");
			}

			const { id, name, args: argsRaw } = message.body.val;
			actionId = id;
			actionName = name;
			const args = cbor.decode(new Uint8Array(argsRaw));

			logger().debug("processing action request", {
				actionId: id,
				actionName: name,
			});

			const ctx = new ActionContext<S, CP, CS, V, I, AD, DB>(
				actor.actorContext,
				conn,
			);

			// Process the action request and wait for the result
			// This will wait for async actions to complete
			const output = await handler.onExecuteAction(ctx, name, args);

			logger().debug("sending action response", {
				actionId: id,
				actionName: name,
				outputType: typeof output,
				isPromise: output instanceof Promise,
			});

			// Send the response back to the client
			conn._sendMessage(
				new CachedSerializer<protocol.ToClient>(
					{
						body: {
							tag: "ActionResponse",
							val: {
								id: id,
								output: bufferToArrayBuffer(cbor.encode(output)),
							},
						},
					},
					TO_CLIENT_VERSIONED,
				),
			);

			logger().debug("action response sent", { id, name: name });
		} else if (message.body.tag === "SubscriptionRequest") {
			// Subscription request

			if (
				handler.onSubscribe === undefined ||
				handler.onUnsubscribe === undefined
			) {
				throw new errors.Unsupported("Subscriptions");
			}

			const { eventName, subscribe } = message.body.val;
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
			assertUnreachable(message.body);
		}
	} catch (error) {
		const { code, message, metadata } = deconstructError(error, logger(), {
			connectionId: conn.id,
			actionId,
			actionName,
		});

		logger().debug("sending error response", {
			actionId,
			actionName,
			code,
			message,
		});

		// Build response
		conn._sendMessage(
			new CachedSerializer<protocol.ToClient>(
				{
					body: {
						tag: "Error",
						val: {
							code,
							message,
							metadata: bufferToArrayBuffer(cbor.encode(metadata)),
							actionId: actionId ?? null,
						},
					},
				},
				TO_CLIENT_VERSIONED,
			),
		);

		logger().debug("error response sent", { actionId, actionName });
	}
}

///**
// * Use `CachedSerializer` if serializing the same data repeatedly.
// */
//export function serialize<T>(value: T, encoding: Encoding): OutputData {
//	if (encoding === "json") {
//		return JSON.stringify(value);
//	} else if (encoding === "cbor") {
//		// TODO: Remove this hack, but cbor-x can't handle anything extra in data structures
//		const cleanValue = JSON.parse(JSON.stringify(value));
//		return cbor.encode(cleanValue);
//	} else {
//		assertUnreachable(encoding);
//	}
//}
//
//export async function deserialize(data: InputData, encoding: Encoding) {
//	if (encoding === "json") {
//		if (typeof data !== "string") {
//			logger().warn("received non-string for json parse");
//			throw new errors.MalformedMessage();
//		} else {
//			return JSON.parse(data);
//		}
//	} else if (encoding === "cbor") {
//		if (data instanceof Blob) {
//			const arrayBuffer = await data.arrayBuffer();
//			return cbor.decode(new Uint8Array(arrayBuffer));
//		} else if (data instanceof Uint8Array) {
//			return cbor.decode(data);
//		} else if (
//			data instanceof ArrayBuffer ||
//			data instanceof SharedArrayBuffer
//		) {
//			return cbor.decode(new Uint8Array(data));
//		} else {
//			logger().warn("received non-binary type for cbor parse");
//			throw new errors.MalformedMessage();
//		}
//	} else {
//		assertUnreachable(encoding);
//	}
//}
