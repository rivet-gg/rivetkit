import { WorkerKeySchema } from "@/common//utils";
import { z } from "zod";
import { EncodingSchema } from "@/worker/protocol/serde";
import {
	HEADER_WORKER_ID,
	HEADER_CONN_ID,
	HEADER_CONN_PARAMS,
	HEADER_CONN_TOKEN,
	HEADER_ENCODING,
	HEADER_WORKER_QUERY,
} from "@/worker/router-endpoints";

export const CreateRequestSchema = z.object({
	name: z.string(),
	key: WorkerKeySchema,
	input: z.unknown().optional(),
	region: z.string().optional(),
});

export const GetForKeyRequestSchema = z.object({
	name: z.string(),
	key: WorkerKeySchema,
});

export const GetOrCreateRequestSchema = z.object({
	name: z.string(),
	key: WorkerKeySchema,
	input: z.unknown().optional(),
	region: z.string().optional(),
});

export const WorkerQuerySchema = z.union([
	z.object({
		getForId: z.object({
			workerId: z.string(),
		}),
	}),
	z.object({
		getForKey: GetForKeyRequestSchema,
	}),
	z.object({
		getOrCreateForKey: GetOrCreateRequestSchema,
	}),
	z.object({
		create: CreateRequestSchema,
	}),
]);

export const ConnectRequestSchema = z.object({
	query: WorkerQuerySchema.describe(HEADER_WORKER_QUERY),
	encoding: EncodingSchema.describe(HEADER_ENCODING),
	connParams: z.string().optional().describe(HEADER_CONN_PARAMS),
});

export const ConnectWebSocketRequestSchema = z.object({
	query: WorkerQuerySchema.describe("query"),
	encoding: EncodingSchema.describe("encoding"),
	connParams: z.unknown().optional().describe("conn_params"),
});

export const ConnMessageRequestSchema = z.object({
	workerId: z.string().describe(HEADER_WORKER_ID),
	connId: z.string().describe(HEADER_CONN_ID),
	encoding: EncodingSchema.describe(HEADER_ENCODING),
	connToken: z.string().describe(HEADER_CONN_TOKEN),
});

export const ResolveRequestSchema = z.object({
	query: WorkerQuerySchema.describe(HEADER_WORKER_QUERY),
	connParams: z.string().optional().describe(HEADER_CONN_PARAMS),
});

export type WorkerQuery = z.infer<typeof WorkerQuerySchema>;
export type GetForKeyRequest = z.infer<typeof GetForKeyRequestSchema>;
export type GetOrCreateRequest = z.infer<typeof GetOrCreateRequestSchema>;
export type ConnectQuery = z.infer<typeof ConnectRequestSchema>;
/**
 * Interface representing a request to create a worker.
 */
export type CreateRequest = z.infer<typeof CreateRequestSchema>;
