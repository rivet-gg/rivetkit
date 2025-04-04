import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import * as crypto from "crypto";
import envPaths from "env-paths";

// Get platform-specific data directory
const paths = envPaths("actor-core", { suffix: "" });

/**
 * Create a hash for a path, normalizing it first
 */
function createHashForPath(dirPath: string): string {
	// Normalize the path first
	const normalizedPath = path.normalize(dirPath);
	
	// Extract the last path component for readability
	const lastComponent = path.basename(normalizedPath);
	
	// Create SHA-256 hash
	const hash = crypto
		.createHash("sha256")
		.update(normalizedPath)
		.digest("hex")
		.substring(0, 8); // Take first 8 characters for brevity
	
	return `${lastComponent}-${hash}`;
}

/**
 * Get the storage path for the current working directory or a specified path
 */
export function getStoragePath(customPath?: string): string {
	const pathToHash = customPath || process.cwd();
	const dirHash = createHashForPath(pathToHash);
	return path.join(paths.data, dirHash);
}

/**
 * Get actor's storage directory
 */
export function getActorStoragePath(baseDir: string, actorId: string): string {
	return path.join(baseDir, "actors", actorId);
}

/**
 * Check if a path exists
 */
export async function pathExists(path: string): Promise<boolean> {
	try {
		await fs.access(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * Ensure a directory exists, creating it if necessary
 */
export async function ensureDirectoryExists(directoryPath: string): Promise<void> {
	if (!await pathExists(directoryPath)) {
		await fs.mkdir(directoryPath, { recursive: true });
	}
}

/**
 * Ensure a directory exists synchronously - only used during initialization
 * All other operations use the async version
 */
export function ensureDirectoryExistsSync(directoryPath: string): void {
	if (!fsSync.existsSync(directoryPath)) {
		fsSync.mkdirSync(directoryPath, { recursive: true });
	}
}

