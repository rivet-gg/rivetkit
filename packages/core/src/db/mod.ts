export interface DatabaseSetupResult<DB> {
	client: DB;
	onMigrate: () => Promise<void>;
}

export type ActorDatabaseConnectionDetails =
	| { url: string }
	| { exec: (...args: any[]) => void }
	| unknown;
export interface DatabaseSetupContext {
	/**
	 * Sets up the database for the actor.
	 * @returns A promise that resolves to the database URL, database instance
	 */
	setupDatabase: () => Promise<ActorDatabaseConnectionDetails>;
}

export type DatabaseSetupFunction<DB> = (
	ctx: DatabaseSetupContext,
) => Promise<DatabaseSetupResult<DB>>;

export type AnyDatabaseProvider = DatabaseProviderOf<any>;
export type DatabaseProviderOf<DB> = { setup: DatabaseSetupFunction<DB> };
export type DatabaseClientOf<DB> = DB extends DatabaseProviderOf<infer C>
	? C
	: never;
export type AnyDatabaseClient = DatabaseClientOf<AnyDatabaseProvider>;
