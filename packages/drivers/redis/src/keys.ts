export const KEYS = {
	ACTOR: {
		// KEY
		initialized: (actorId: string) => `actor:${actorId}:initialized`,
		LEASE: {
			// KEY (expire) = node ID
			node: (actorId: string) => `actor:${actorId}:lease:node`,
		},
		// KEY
		metadata: (actorId: string) => `actor:${actorId}:metadata`,
		// KEY
		persistedData: (actorId: string) => `actor:${actorId}:persisted_data`,
	},
};

export const PUBSUB = {
	node(nodeId: string) {
		return `node:${nodeId}:messages`;
	},
};
