import { z } from "zod";

export const ProtocolFormatSchema = z.enum(["json", "cbor"]);
export const TransportKindSchema = z.enum(["websocket", "sse"]);

/**
 * Protocol format used to communicate between the client & actor.
 */
export type ProtocolFormat = z.infer<typeof ProtocolFormatSchema>;

/**
 * Transport mechanism used to communicate between client & actor.
 */
export type TransportKind = z.infer<typeof TransportKindSchema>;

