import { betterAuth } from "better-auth";
import { sqliteAdapter } from "@better-auth/sqlite";
import Database from "better-sqlite3";

const db = new Database("./auth.db");

export const auth = betterAuth({
	database: sqliteAdapter(db),
	emailAndPassword: {
		enabled: true,
	},
	session: {
		expiresIn: 60 * 60 * 24 * 7, // 7 days
		updateAge: 60 * 60 * 24, // 1 day (every day the session expiry is updated)
	},
	plugins: [],
});

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.User;