import { actor, setup } from "@rivetkit/actor";
import { db } from "@rivetkit/db/drizzle";
import migrations from "../drizzle/migrations";
import * as schema from "./schema";

const counter = actor({
	db: db({
		schema,
		migrations,
	}),
	state: {
		count: 0,
		boolean: false,
		string: "",
		number: 0,
		array: [{ id: 1, value: "value", object: { key: "value" } }],
		object: { key: "value" },
		nestedObject: { nestedKey: "nestedValue" },
		nestedArray: [{ id: 1, value: "value", object: { key: "value" } }],
		nestedObjectArray: [{ id: 1, value: "value", object: { key: "value" } }],
		nestedArrayObject: [{ id: 1, value: "value", object: { key: "value" } }],
		nestedArrays: [
			[
				{
					id: 1,
					value: "value",
					object: { key: "value" },
					array: [{ key: "value", array: [{ key: "value" }] }],
				},
			],
			[
				{
					id: 2,
					value: "value2",
					object: { key: "value2" },
					array: [{ key: "value", array: [{ key: "value" }] }],
				},
			],
		],
		undefined: undefined,
		date: new Date(),
		dateArray: [new Date(), new Date()],
		dateObject: { date: new Date() },
		null: null,
	},
	onAuth: () => {
		return true;
	},
	onStart: (c) => {
		c.schedule.after(1000, "increment", 1);

		c.state.count = 0;
	},
	actions: {
		increment: (c, x: number) => {
			// c.db.insert(schema.usersTable).values({
			// 	name: "John Doe",
			// 	age: 30,
			// 	email: "john.doe@example.com",
			// });
			c.state.count += x;
			c.broadcast("newCount", c.state.count);
			return c.state.count;
		},
		getCount: (c) => {
			return c.state.count;
		},
		addRecords: async (c) => {
			const user = {
				name: "John",
				age: 30,
				email: `john+${Date.now()}@example.com`,
			};

			const returned = await c.db
				.insert(schema.usersTable)
				.values(user)
				.returning();
			console.log("New user created!");

			await Promise.all(
				Array.from({ length: 10 })
					.fill("")
					.map(async (_, i) => {
						const post = {
							title: `My ${i} post`,
							content: "Hello world!",
							userId: returned[0].id,
						};
						await c.db.insert(schema.postsTable).values(post);
						console.log("New post created!");
					}),
			);

			const all: typeof schema.allTypesTable.$inferInsert = {
				text: "Hello",
				blob: new Uint8Array([1, 2, 3]),
				numeric: "123.45",
				real: 123.45,
				int: 123,
				text_json: { key: "value" },
				text_enum: "value1",
				blob_buffer: Buffer.from([1, 2, 3]),
				blob_bigint: BigInt("1234567890123456789"),
				blob_json: { key: "value" },
				numeric_number: 123.45,
				numeric_bigint: BigInt("1234567890123456789"),
				notnull_int: 0,
			};
			await c.db.insert(schema.allTypesTable).values(all);
			console.log("New all types created!");
		},
	},
});

export const registry = setup({
	use: { counter },
});

export type Registry = typeof registry;
