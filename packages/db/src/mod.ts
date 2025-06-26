import type {
	DatabaseProviderOf,
	DatabaseSetupFunction,
} from "@rivetkit/core/db";
import * as SQLite from "better-sqlite3";

/**
 * On serverless environments, we use a shim, as not all methods are available.
 * This is a minimal shim that only includes the `exec` method, which is used for
 * running raw SQL commands.
 */
type SQLiteShim = Pick<SQLite.Database, "exec">;

interface DatabaseFactoryConfig {
	onMigrate?: (db: SQLiteShim) => void;
}

export function db({ onMigrate }: DatabaseFactoryConfig = {}): {
	setup: DatabaseSetupFunction<SQLiteShim>;
} {
	// @ts-ignore
	return {
		setup: async (ctx) => {
			const conn = await ctx.setupDatabase();

			if (!conn) {
				throw new Error(
					"Cannot create database connection, or database feature is not enabled.",
				);
			}

			if (
				typeof conn === "object" &&
				conn &&
				"url" in conn &&
				typeof conn.url === "string"
			) {
				// if the connection is already an object with exec method, return it
				// i.e. in serverless environments (cloudflare)
				const client = new SQLite(conn.url);
				return {
					client,
					onMigrate: () => {
						return onMigrate?.(client) || Promise.resolve();
					},
				};
			}

			if (typeof conn !== "object" || !("exec" in conn)) {
				throw new Error(
					"Invalid database connection. Expected an object with an 'exec' method.",
				);
			}

			return {
				client: conn as SQLiteShim,
				onMigrate: () => {
					return onMigrate?.(conn as SQLiteShim) || Promise.resolve();
				},
			};
		},
	} satisfies DatabaseProviderOf<SQLiteShim>;
}
