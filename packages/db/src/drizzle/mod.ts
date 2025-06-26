import {
	type BetterSQLite3Database,
	drizzle as sqliteDrizzle,
} from "drizzle-orm/better-sqlite3";
import type {
	DatabaseProviderOf,
	DatabaseSetupFunction,
} from "@rivetkit/core/db";

import { drizzle as durableDrizzle } from "drizzle-orm/durable-sqlite";
import { migrate as durableMigrate } from "drizzle-orm/durable-sqlite/migrator";
import Database from "better-sqlite3";
export * from "drizzle-orm/sqlite-core";

import { defineConfig as originalDefineConfig, type Config } from "drizzle-kit";

export function defineConfig(
	config: Partial<Config & { driver: "durable-sqlite" }>,
): Config {
	// Pre-configures the defineConfig function to use the durable-sqlite driver, for convenience.
	return originalDefineConfig({
		dialect: "sqlite",
		driver: "durable-sqlite",
		...config,
	});
}

interface DatabaseFactoryConfig<
	TSchema extends Record<string, unknown> = Record<string, never>,
> {
	/**
	 * The database schema.
	 */
	schema?: TSchema;
	migrations?: Parameters<typeof durableMigrate>[1];
}

export function db<
	TSchema extends Record<string, unknown> = Record<string, never>,
>(
	config?: DatabaseFactoryConfig<TSchema>,
): { setup: DatabaseSetupFunction<BetterSQLite3Database<TSchema>> } {
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
				const client = sqliteDrizzle({
					client: new Database(conn.url),
					...config,
				});

				return {
					client,
					onMigrate: async () => {
						if (config?.migrations) {
							await durableMigrate(client, config.migrations);
						}
					},
				};
			}

			if (typeof conn !== "object" || !("exec" in conn)) {
				throw new Error(
					"Invalid database connection. Expected an object with an 'exec' method.",
				);
			}

			// If the connection is already an object with exec method, return it
			// i.e. in serverless environments (Cloudflare Workers)
			const client = durableDrizzle(conn, config);
			return {
				client,
				onMigrate: async () => {
					if (config?.migrations) {
						await durableMigrate(client, config.migrations);
					}
				},
			};
		},
	} satisfies DatabaseProviderOf<BetterSQLite3Database<TSchema>>;
}
