import * as crypto from "node:crypto";
import type { ActorKey } from "@rivetkit/core";

/**
 * Generate a deterministic actor ID from name and key
 */
export function generateActorId(name: string, key: ActorKey): string {
	// Generate deterministic key string
	const jsonString = JSON.stringify([name, key]);

	// Hash to ensure safe file system names
	const hash = crypto
		.createHash("sha256")
		.update(jsonString)
		.digest("hex")
		.substring(0, 16);

	return hash;
}
