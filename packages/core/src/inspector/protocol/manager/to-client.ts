// import { z } from "zod";
//
// const WorkerSchema = z.object({
// 	id: z.string(),
// 	name: z.string(),
// 	key: z.array(z.string()),
// });
//
// export type Worker = z.infer<typeof WorkerSchema>;
//
// export const ToClientSchema = z.discriminatedUnion("type", [
// 	z.object({
// 		type: z.literal("info"),
// 		workers: z.array(WorkerSchema),
// 		types: z.array(z.string()),
// 	}),
// 	z.object({
// 		type: z.literal("workers"),
// 		workers: z.array(WorkerSchema),
// 	}),
// 	z.object({
// 		type: z.literal("error"),
// 		message: z.string(),
// 	}),
// ]);
//
// export type ToClient = z.infer<typeof ToClientSchema>;
