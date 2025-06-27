import Database from "better-sqlite3";

// Create SQLite database and tables for Better Auth
const db = new Database("/tmp/auth.sqlite");

// Create user table
db.exec(`
  CREATE TABLE IF NOT EXISTS user (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    emailVerified BOOLEAN NOT NULL DEFAULT FALSE,
    name TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  );
`);

// Create session table
db.exec(`
  CREATE TABLE IF NOT EXISTS session (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    expiresAt INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    ipAddress TEXT,
    userAgent TEXT,
    FOREIGN KEY (userId) REFERENCES user(id) ON DELETE CASCADE
  );
`);

// Create account table
db.exec(`
  CREATE TABLE IF NOT EXISTS account (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    accountId TEXT NOT NULL,
    providerId TEXT NOT NULL,
    accessToken TEXT,
    refreshToken TEXT,
    idToken TEXT,
    accessTokenExpiresAt INTEGER,
    refreshTokenExpiresAt INTEGER,
    scope TEXT,
    password TEXT,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    FOREIGN KEY (userId) REFERENCES user(id) ON DELETE CASCADE
  );
`);

// Create verification table
db.exec(`
  CREATE TABLE IF NOT EXISTS verification (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    expiresAt INTEGER NOT NULL,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  );
`);

console.log("Database tables created successfully!");
db.close();
