export const KEYS = {
	ACTOR: {
		// KEY
		LEASE: {
			// KEY (expire) = node ID
			node: (prefix: string, actorId: string) =>
				`${prefix}:actor:${actorId}:lease:node`,
		},
		// KEY
		metadata: (prefix: string, actorId: string) =>
			`${prefix}:actor:${actorId}:metadata`,
		// KEY
		persistedData: (prefix: string, actorId: string) =>
			`${prefix}:actor:${actorId}:persisted_data`,
	},

	// KEY
	actorByKey: (prefix: string, name: string, key: string[]) => {
		// Base prefix for actor key lookups
		let redisKey = `${prefix}:actor_by_key:${escapeRedisKey(name)}`;

		// Add each key component with proper escaping
		if (key.length > 0) {
			redisKey += `:${key.map((k) => escapeRedisKey(k)).join(":")}`;
		}

		return redisKey;
	},
};

export const PUBSUB = {
	node(prefix: string, nodeId: string) {
		return `${prefix}:node:${nodeId}:messages`;
	},
};

// Escape special characters in Redis keys
// Redis keys shouldn't contain spaces or control characters
// and we need to escape the delimiter character (:)
function escapeRedisKey(part: string): string {
	return part
		.replace(/\\/g, "\\\\") // Escape backslashes first
		.replace(/:/g, "\\:"); // Escape colons (our delimiter)
}
