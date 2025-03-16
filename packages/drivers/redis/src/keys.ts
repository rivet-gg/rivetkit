export const KEYS = {
	ACTOR: {
		// KEY
		initialized: (actorId: string) => `actor:${actorId}:initialized`,
		LEASE: {
			// KEY (expire) = node ID
			node: (actorId: string) => `actor:${actorId}:lease:node`,
		},
		// KEY
		name: (actorId: string) => `actor:${actorId}:name`,
		// KEY
		tags: (actorId: string) => `actor:${actorId}:tags`,
		// KEY
		kv: (actorId: string, key: string) => `actor:${actorId}:kv:${key}`,
	},
};

export const PUBSUB = {
	node(nodeId: string) {
		return `node:${nodeId}:messages`;
	},
};
