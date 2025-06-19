// import { z } from "zod";
//
// const ConnSchema = z.object({
// 	id: z.string(),
// 	parameters: z.any(),
// 	state: z.object({
// 		enabled: z.boolean(),
// 		value: z.any().optional(),
// 	}),
// });
//
// export const InspectDataSchema = z.object({
// 	connections: z.array(ConnSchema),
// 	actions: z.array(z.string()),
// 	state: z.object({
// 		enabled: z.boolean(),
// 		value: z.any().optional(),
// 	}),
// });
//
// export type InspectData = z.infer<typeof InspectDataSchema>;
//
// export const ToClientSchema = z.discriminatedUnion("type", [
// 	z
// 		.object({
// 			type: z.literal("info"),
// 		})
// 		.merge(InspectDataSchema),
// 	z.object({
// 		type: z.literal("error"),
// 		message: z.string(),
// 	}),
// ]);
//
// export type ToClient = z.infer<typeof ToClientSchema>;
