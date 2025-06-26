import { actor, setup } from "@rivetkit/actor";
import { db } from "@rivetkit/db/drizzle";
import * as schema from "./db/schema";
import migrations from "../drizzle/migrations";

export const contacts = actor({
	db: db({ schema, migrations }),
	onAuth: async (c) => {},
	actions: {
		insert: async (c, record: { name: string; age: number; email: string }) => {
			// Example of using the DB
			const result = await c.db.insert(schema.usersTable).values(record);
			return result;
		},
		read: async (c) => {
			// Example of reading from the DB
			const users = await c.db.query.usersTable.findMany();
			return users;
		},
		search: async (c, query: string) => {
			// Example of searching in the DB
			const users = await c.db.query.usersTable.findMany({
				where: (table, { ilike }) => ilike(table.name, `%${query}%`),
			});
			return users;
		},
	},
});

export const registry = setup({
	use: { contacts },
});

export type Registry = typeof registry;
