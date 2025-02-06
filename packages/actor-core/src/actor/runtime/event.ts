import type * as wsToClient from "@/actor/protocol/ws/to_client";
import * as wsToServer from "@/actor/protocol/ws/to_server";
import type { AnyActor } from "./actor";
import type { Connection, IncomingMessage } from "./connection";
import * as errors from "./errors";
import { logger } from "./log";
import { Rpc } from "./rpc";
import { assertUnreachable } from "./utils";

interface MessageEventConfig {
	connections: { maxIncomingMessageSize: number };
}

export async function validateMessageEvent<A extends AnyActor>(
	value: IncomingMessage,
	connection: Connection<A>,
	config: MessageEventConfig,
) {
	// Validate value length
	let length: number;
	if (typeof value === "string") {
		length = value.length;
	} else if (value instanceof Blob) {
		length = value.size;
	} else if (
		value instanceof ArrayBuffer ||
		value instanceof SharedArrayBuffer
	) {
		length = value.byteLength;
	} else {
		assertUnreachable(value);
	}
	if (length > config.connections.maxIncomingMessageSize) {
		throw new errors.MessageTooLong();
	}

	// Parse & validate message
	const {
		data: message,
		success,
		error,
	} = wsToServer.ToServerSchema.safeParse(await connection._parse(value));

	if (!success) {
		throw new errors.MalformedMessage(error);
	}

	return message;
}

export interface HandleMessageEventDelegate<A extends AnyActor> {
	onExecuteRpc?: (
		ctx: Rpc<A>,
		name: string,
		args: unknown[],
	) => Promise<unknown>;
	onSubscribe?: (eventName: string, conn: Connection<A>) => Promise<void>;
	onUnsubscribe?: (eventName: string, conn: Connection<A>) => Promise<void>;
}

export async function handleMessageEvent<A extends AnyActor>(
	value: IncomingMessage,
	conn: Connection<A>,
	config: MessageEventConfig,
	handlers: HandleMessageEventDelegate<A>,
) {
	let rpcId: number | undefined;
	let rpcName: string | undefined;
	const message = await validateMessageEvent(value, conn, config);

	try {
		if ("rr" in message.b) {
			// RPC request

			if (handlers.onExecuteRpc === undefined) {
				throw new errors.Unsupported("RPC");
			}

			const { i: id, n: name, a: args = [] } = message.b.rr;

			rpcId = id;
			rpcName = name;

			const ctx = new Rpc<A>(conn);
			const output = await handlers.onExecuteRpc(ctx, name, args);

			await conn._sendMessage(
				conn._serialize({
					b: {
						ro: {
							i: id,
							o: output,
						},
					},
				} satisfies wsToClient.ToClient),
			);
		} else if ("sr" in message.b) {
			// Subscription request

			if (
				handlers.onSubscribe === undefined ||
				handlers.onUnsubscribe === undefined
			) {
				throw new errors.Unsupported("Subscriptions");
			}

			const { e: eventName, s: subscribe } = message.b.sr;

			if (subscribe) {
				await handlers.onSubscribe(eventName, conn);
			} else {
				await handlers.onUnsubscribe(eventName, conn);
			}
		} else {
			assertUnreachable(message.b);
		}
	} catch (error) {
		// Build response error information. Only return errors if flagged as public in order to prevent leaking internal behavior.
		//
		// We log the error here instead of after generating the code & message because we need to log the original error, not the masked internal error.
		let code: string;
		let message: string;
		let metadata: unknown = undefined;
		if (error instanceof errors.ActorError && error.public) {
			code = error.code;
			message = String(error);
			metadata = error.metadata;

			logger().info("public error", {
				code,
				message,
				connectionId: conn.id,
				rpcId,
				rpcName,
			});
		} else {
			code = errors.INTERNAL_ERROR_CODE;
			message = errors.INTERNAL_ERROR_DESCRIPTION;
			metadata = {
				//url: `https://hub.rivet.gg/projects/${actorMetadata.project.slug}/environments/${actorMetadata.environment.slug}/actors?actorId=${actorMetadata.actor.id}`,
			} satisfies errors.InternalErrorMetadata;

			logger().warn("internal error", {
				error: String(error),
				connectionId: conn.id,
				rpcId,
				rpcName,
			});
		}

		// Build response
		if (rpcId !== undefined) {
			await conn._sendMessage(
				conn._serialize({
					b: {
						re: {
							i: rpcId,
							c: code,
							m: message,
							md: metadata,
						},
					},
				} satisfies wsToClient.ToClient),
			);
		} else {
			await conn._sendMessage(
				conn._serialize({
					b: {
						er: {
							c: code,
							m: message,
							md: metadata,
						},
					},
				} satisfies wsToClient.ToClient),
			);
		}
	}
}
