import { z } from "zod";

export const EncodingSchema = z.enum(["json", "cbor"]);
export const TransportSchema = z.enum(["websocket", "sse"]);

/**
 * Encoding used to communicate between the client & actor.
 */
export type Encoding = z.infer<typeof EncodingSchema>;

/**
 * Transport mechanism used to communicate between client & actor.
 */
export type Transport = z.infer<typeof TransportSchema>;

