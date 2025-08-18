export type AnyDatabaseProvider = DatabaseProvider<any> | undefined;

export type DatabaseProvider<DB extends RawAccess> = {
	/**
	 * Creates a new database client for the actor.
	 * The result is passed to the actor context as `c.db`.
	 * @experimental
	 */
	createClient: (ctx: {
		getDatabase: () => Promise<string | unknown>;
	}) => Promise<DB>;
	/**
	 * Runs before the actor has started.
	 * Use this to run migrations or other setup tasks.
	 * @experimental
	 */
	onMigrate: (client: DB) => void | Promise<void>;
};

type PrepareFunction = (query: string, ...args: unknown[]) => Statement;

type Statement = {
	all(...args: unknown[]): Promise<unknown[]>;
	run(...args: unknown[]): Promise<unknown>;
};

export type RawAccess = {
	/**
	 * Prepares a raw SQL query.
	 */
	prepare: PrepareFunction;
};
