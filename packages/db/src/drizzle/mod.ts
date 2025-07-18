import * as Database from "better-sqlite3";
import {
	type BetterSQLite3Database,
	drizzle as sqliteDrizzle,
} from "drizzle-orm/better-sqlite3";
import { drizzle as durableDrizzle } from "drizzle-orm/durable-sqlite";
import {
	migrate as durableMigrate,
	migrate as sqliteMigrate,
} from "drizzle-orm/durable-sqlite/migrator";
import type { DatabaseFactory } from "@/config";

export * from "drizzle-orm/sqlite-core";

import { type Config, defineConfig as originalDefineConfig } from "drizzle-kit";

export function defineConfig(
	config: Partial<Config & { driver: "durable-sqlite" }>,
): Config {
	// This is a workaround to avoid the "drizzle-kit" import issue in the examples.
	// It allows us to use the same defineConfig function in both the main package and the examples.
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
	migrations?: any;
}

export function db<
	TSchema extends Record<string, unknown> = Record<string, never>,
>(
	config?: DatabaseFactoryConfig<TSchema>,
): DatabaseFactory<BetterSQLite3Database<TSchema>> {
	return async (ctx) => {
		const conn = await ctx.createDatabase();

		if (!conn) {
			throw new Error(
				"Cannot create database connection, or database feature is not enabled.",
			);
		}

		if (typeof conn === "object" && conn && "exec" in conn) {
			// If the connection is already an object with exec method, return it
			// i.e. in serverless environments (Cloudflare Workers)
			const client = durableDrizzle(conn, config);
			return {
				client,
				onMigrate: async () => {
					await durableMigrate(client, config?.migrations);
				},
			};
		}

		const client = sqliteDrizzle({
			client: new Database(conn as string),
			...config,
		});

		return {
			client,
			onMigrate: async () => {
				await sqliteMigrate(client, config?.migrations);
			},
		};
	};
}
