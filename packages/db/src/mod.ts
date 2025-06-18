import * as SQLite from "better-sqlite3";
import type { DatabaseFactory } from "./config";

/**
 * On serverless environments, we use a shim, as not all methods are available.
 * This is a minimal shim that only includes the `exec` method, which is used for
 * running raw SQL commands.
 */
type SQLiteShim = Pick<SQLite.Database, "exec">;

interface DatabaseFactoryConfig {
	onMigrate?: (db: SQLiteShim) => void;
}

export function db({
	onMigrate,
}: DatabaseFactoryConfig = {}): DatabaseFactory<SQLiteShim> {
	return async (ctx) => {
		const conn = await ctx.createDatabase();

		if (!conn) {
			throw new Error(
				"Cannot create database connection, or database feature is not enabled.",
			);
		}

		if (typeof conn === "object" && conn && "exec" in conn) {
			// if the connection is already an object with exec method, return it
			// i.e. in serverless environments (cloudflare)
			return {
				client: conn as SQLiteShim,
				onMigrate: () => {
					onMigrate?.(client);
				},
			};
		}

		const client = new SQLite(conn as string);
		return {
			client,
			onMigrate: () => {
				onMigrate?.(client);
			},
		};
	};
}
