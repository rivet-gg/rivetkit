export interface DatabaseConfig<DB> {
	client: DB;
	onMigrate: () => void;
}

export interface DatabaseFactoryContext<DB> {
	createDatabase: () => Promise<unknown>;
}

export type DatabaseFactory<DB> = (
	ctx: DatabaseFactoryContext<DB>,
) => Promise<DatabaseConfig<DB>>;
