/**
 * Shared types for the application
 */

// Linear webhook event for server integration
export interface LinearWebhookEvent {
	type: string;
	action: string;
	data: {
		id: string;
		identifier: string;
		title?: string;
		description?: string;
		state?: {
			name: string;
			id?: string;
		};
		body?: string;
		user?: {
			isBot?: boolean;
		};
		issue?: {
			id: string;
		};
	};
	updatedFrom?: {
		stateId?: string;
	};
	updatedAt?: string; // ISO timestamp when the event was updated
}
