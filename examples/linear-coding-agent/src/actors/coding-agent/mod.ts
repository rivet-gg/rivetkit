import { type ActionContextOf, type ActorContextOf, actor } from "actor-core";
import type {
	CodingAgentState,
	CodingAgentVars,
	LinearWebhookEvent,
	QueuedRequest,
	RequestType,
} from "./types";
import { getConfig } from "../../config";
import * as github from "./github";
import * as linear from "./linear";
import * as llm from "./llm";
import { LLMMessage } from "./llm";
import { randomUUID } from "crypto";
import {
	handleIssueCreated,
	handleCommentCreated,
	handleIssueUpdated,
	getIssueStatus
} from "./linear";

export type Ctx =
	| ActorContextOf<typeof codingAgent>
	| ActionContextOf<typeof codingAgent>;

/**
 * Update the debug state
 */
export function updateDebugState(c: Ctx, operation: string, stage: string, requestId?: string, status: 'working' | 'success' | 'failure' = 'working'): void {
	// Safety check - ensure state and debug objects exist
	try {
		if (c.state && typeof c.state === 'object') {
			// Initialize debug object if it doesn't exist
			if (!c.state.debug) {
				c.state.debug = {
					currentOperation: "initializing",
					lastUpdated: Date.now(),
					stage: "starting",
					requestId: undefined
				};
			}
			
			// Update the debug state
			c.state.debug = {
				currentOperation: operation,
				stage: stage,
				lastUpdated: Date.now(),
				requestId: requestId
			};
		}
	} catch (error) {
		console.warn(`[DEBUG] Unable to update debug state: ${error}`);
	}
	
	// Choose emoji based on status
	let emoji = '👀'; // Default for working
	if (status === 'success') {
		emoji = '✅';
	} else if (status === 'failure') {
		emoji = '❌';
	}
	
	// Log with appropriate emoji to indicate status
	console.log(`${emoji} [DEBUG] ${operation} - ${stage}${requestId ? ` (${requestId})` : ''}`);
}

/**
 * Process a queued request
 */
async function processRequest(c: Ctx, request: QueuedRequest): Promise<void> {
	if (!request || !request.id || !request.type) {
		console.error(`❌ [QUEUE] Invalid request object:`, request);
		return;
	}
	
	console.log(`🤖 [QUEUE] Processing request: ${request.id} (${request.type})`);
	
	try {
		// Mark request as processing
		request.status = 'processing';
		
		// Update debug state with working indicator
		updateDebugState(c, `Processing ${request.type}`, 'starting', request.id, 'working');
		
		// Make sure data is available
		if (!request.data) {
			throw new Error(`Request data is missing for ${request.id}`);
		}
		
		// Enhanced logging with request details
		if (request.type === 'commentCreated') {
			console.log(`🔍 [QUEUE] Comment details:`, {
				id: request.data.data.id,
				body: request.data.data.body?.substring(0, 100) + (request.data.data.body && request.data.data.body.length > 100 ? '...' : ''),
				issueId: request.data.data.issue?.id,
				userIsBot: request.data.data.user?.isBot,
				action: request.data.action
			});
		}
		
		// Process based on request type
		switch (request.type) {
			case 'issueCreated':
				console.log(`🤖 [QUEUE] Bot is handling a new issue creation event`);
				await handleIssueCreated(c, request.data);
				break;
			case 'commentCreated':
				console.log(`🤖 [QUEUE] Bot is processing a new comment on an issue`);
				
				// Log the status of the issue referenced in the comment
				if (request.data.data.issue?.id) {
					try {
						const currentStatus = await getIssueStatus(c, request.data.data.issue.id);
						console.log(`🤖 [QUEUE] Issue status for the comment: ${currentStatus}`);
					} catch (err) {
						console.warn(`🤖 [QUEUE] Could not fetch issue status: ${err}`);
					}
				}
				
				await handleCommentCreated(c, request.data);
				console.log(`🤖 [QUEUE] Finished processing comment`);
				break;
			case 'issueUpdated':
				console.log(`🤖 [QUEUE] Bot is handling an issue status update`);
				await handleIssueUpdated(c, request.data);
				break;
			default:
				console.log(`❌ [QUEUE] Unknown request type: ${request.type}`);
				throw new Error(`Unknown request type: ${request.type}`);
		}
		
		// Mark request as completed
		request.status = 'completed';
		updateDebugState(c, `Completed ${request.type}`, 'finished', request.id, 'success');
		console.log(`✅ [QUEUE] Request completed successfully: ${request.id} (${request.type})`);
	} catch (error) {
		// Mark request as failed
		try {
			request.status = 'failed';
			request.error = error instanceof Error ? error.message : String(error);
		} catch (e) {
			// In case updating the request itself fails
			console.error(`❌ [QUEUE] Could not update request status:`, e);
		}
		
		updateDebugState(c, `Failed ${request.type}`, 'error', request.id, 'failure');
		console.error(`❌ [QUEUE] Request failed: ${request.id} (${request.type})`, error);
	}
}

/**
 * Process the queue
 */
async function processQueue(c: Ctx): Promise<void> {
	try {
		// Safety check - ensure queue exists
		if (!c.state.queue) {
			console.warn(`🤖 [QUEUE] Queue not initialized in state, initializing now`);
			c.state.queue = {
				requests: [],
				isProcessing: false,
				lastProcessed: 0
			};
		}
		
		// Safety check - ensure requests array exists
		if (!Array.isArray(c.state.queue.requests)) {
			console.warn(`🤖 [QUEUE] Queue requests not initialized in state, initializing now`);
			c.state.queue.requests = [];
		}
		
		console.log(`🤖 [QUEUE] Starting queue processing, ${c.state.queue.requests.length} items in queue`);
		
		// Mark as processing
		c.state.queue.isProcessing = true;
		updateDebugState(c, "Queue processing", "starting");
		
		try {
			// Process each pending request in order
			while (true) {
				// Safety check - ensure requests array still exists
				if (!Array.isArray(c.state.queue.requests)) {
					console.warn(`🤖 [QUEUE] Queue requests array was lost, recreating`);
					c.state.queue.requests = [];
					break;
				}
				
				// Find the next pending request
				const nextRequest = c.state.queue.requests.find(r => r.status === 'pending');
				
				// If no pending requests, exit the loop
				if (!nextRequest) {
					updateDebugState(c, "Queue processing", "no more pending requests", undefined, 'success');
					console.log(`🤖 [QUEUE] No more pending requests to process`);
					break;
				}
				
				// Update debug before processing
				console.log(`🤖 [QUEUE] Preparing to process ${nextRequest.type} request (${nextRequest.id})`);
				updateDebugState(c, "Queue processing", `preparing to process ${nextRequest.type}`, nextRequest.id);
				
				// Process the request
				await processRequest(c, nextRequest);
				
				// Update last processed timestamp
				c.state.queue.lastProcessed = Date.now();
				console.log(`🤖 [QUEUE] Updated last processed timestamp to ${new Date(c.state.queue.lastProcessed).toISOString()}`);
			}
		} finally {
			// Mark as not processing
			c.state.queue.isProcessing = false;
			updateDebugState(c, "Queue processing", "finished", undefined, 'success');
			console.log(`✅ [QUEUE] Finished queue processing`);
		}
	} catch (error) {
		console.error(`❌ [QUEUE] Fatal error in queue processing: ${error}`);
		
		// Try to reset the processing flag even in case of errors
		try {
			if (c.state && c.state.queue) {
				c.state.queue.isProcessing = false;
			}
		} catch (e) {
			console.error(`❌ [QUEUE] Could not reset processing flag: ${e}`);
		}
		
		updateDebugState(c, "Queue processing", `fatal error: ${error}`, undefined, 'failure');
	}
}

/**
 * Start queue processing if not already processing
 */
function startQueueProcessing(c: Ctx): void {
	try {
		// Safety check - ensure queue exists
		if (!c.state.queue) {
			console.warn(`🤖 [QUEUE] Queue not initialized in state, initializing now`);
			c.state.queue = {
				requests: [],
				isProcessing: false,
				lastProcessed: 0
			};
		}
		
		// Safety check - ensure requests array exists
		if (!Array.isArray(c.state.queue.requests)) {
			console.warn(`🤖 [QUEUE] Queue requests not initialized in state, initializing now`);
			c.state.queue.requests = [];
		}
		
		// Log current queue state
		const pendingCount = c.state.queue.requests.filter(r => r.status === 'pending').length;
		const processingCount = c.state.queue.requests.filter(r => r.status === 'processing').length;
		const completedCount = c.state.queue.requests.filter(r => r.status === 'completed').length;
		const failedCount = c.state.queue.requests.filter(r => r.status === 'failed').length;
		
		console.log(`🤖 [QUEUE] Queue status: ${pendingCount} pending, ${processingCount} processing, ${completedCount} completed, ${failedCount} failed`);
		
		// Log details of pending requests for debugging
		if (pendingCount > 0) {
			const pendingRequests = c.state.queue.requests.filter(r => r.status === 'pending');
			console.log(`🤖 [QUEUE] Pending requests details:`);
			pendingRequests.forEach(req => {
				console.log(`  - ID: ${req.id}, Type: ${req.type}, Event data: ${JSON.stringify({
					id: req.data.data.id,
					type: req.data.type,
					action: req.data.action,
					issue: req.data.data.issue?.id,
					hasUser: !!req.data.data.user,
					isBot: req.data.data.user?.isBot
				})}`);
			});
		}
		
		// If already processing, return
		if (c.state.queue.isProcessing) {
			console.log(`🤖 [QUEUE] Queue is already being processed - no action needed`);
			updateDebugState(c, "Queue start attempt", "already processing");
			return;
		}
		
		// If no pending requests, return
		if (!c.state.queue.requests.some(r => r.status === 'pending')) {
			console.log(`🤖 [QUEUE] No pending requests to process - queue remains idle`);
			updateDebugState(c, "Queue start attempt", "no pending requests");
			return;
		}
		
		console.log(`🤖 [QUEUE] Bot is starting queue processing`);
		updateDebugState(c, "Queue starting", "initiating");
		
		// Start processing
		c.vars.queueProcessingPromise = processQueue(c);
		console.log(`🤖 [QUEUE] Queue processor started in background`);
	} catch (error) {
		console.error(`🤖 [QUEUE] Error starting queue processing: ${error}`);
		updateDebugState(c, "Queue error", `Failed to start queue: ${error}`, undefined, 'failure');
	}
}

/**
 * Add request to queue
 */
function enqueueRequest(c: Ctx, type: RequestType, data: LinearWebhookEvent): string {
	try {
		// Safety check - ensure queue exists
		if (!c.state.queue) {
			console.warn(`🤖 [QUEUE] Queue not initialized in state, initializing now`);
			c.state.queue = {
				requests: [],
				isProcessing: false,
				lastProcessed: 0
			};
		}
		
		// Safety check - ensure requests array exists
		if (!Array.isArray(c.state.queue.requests)) {
			console.warn(`🤖 [QUEUE] Queue requests not initialized in state, initializing now`);
			c.state.queue.requests = [];
		}
		
		// Create request with unique ID
		const requestId = randomUUID();
		console.log(`🤖 [QUEUE] Creating new ${type} request with ID: ${requestId}`);
		
		const request: QueuedRequest = {
			id: requestId,
			type,
			timestamp: Date.now(),
			data,
			status: 'pending'
		};
		
		// Add to queue
		c.state.queue.requests.push(request);
		console.log(`🤖 [QUEUE] Added request to queue: ${requestId} (${type})`);
		updateDebugState(c, "Request enqueued", `added ${type} request to queue`, requestId);
		
		// Log queue status after adding
		const pendingCount = c.state.queue.requests.filter(r => r.status === 'pending').length;
		console.log(`🤖 [QUEUE] Queue now has ${pendingCount} pending requests`);
		
		// Start processing if not already
		console.log(`🤖 [QUEUE] Attempting to start queue processing`);
		startQueueProcessing(c);
		
		return requestId;
	} catch (error) {
		console.error(`🤖 [QUEUE] Error enqueueing request: ${error}`);
		updateDebugState(c, "Queue error", `Failed to enqueue request: ${error}`, undefined, 'failure');
		return randomUUID(); // Return a fallback ID
	}
}

export const codingAgent = actor({
	// Initialize state
	state: {
		// Linear issue information
		linear: {
			issueId: "",
			status: "In Progress",
			llmProgressCommentId: null, // Using null instead of undefined for better serialization
		},

		// GitHub repository information
		github: {
			owner: "",
			repo: "",
			baseBranch: "main",
			branchName: "",
			prInfo: null,
		},

		// Source code state
		code: {
			fileTree: [],
			modifiedFiles: {},
		},

		// LLM conversation history
		llm: {
			history: [] as LLMMessage[],
		},
		
		// Request queue
		queue: {
			requests: [],
			isProcessing: false,
			lastProcessed: 0
		},
		
		// Debug information
		debug: {
			currentOperation: "initializing",
			lastUpdated: Date.now(),
			stage: "starting",
			requestId: undefined
		}
	} as CodingAgentState,

	// Initialize variables (non-persisted)
	createVars: () => {
		return {} as CodingAgentVars;
	},

	// Handle actor instantiation
	onCreate: (c) => {
		console.log(`[ACTOR] Created actor instance with tags: ${JSON.stringify(c.tags)}`);
		updateDebugState(c, "Actor created", `with tags: ${JSON.stringify(c.tags)}`);
	},
	
	// Handle actor start
	onStart: (c) => {
		console.log(`[ACTOR] Starting actor instance`);
		updateDebugState(c, "Actor starting", "initialization");
		
		// Safety check - ensure queue exists
		if (!c.state.queue) {
			console.warn(`[ACTOR] Queue not initialized in state, initializing now`);
			c.state.queue = {
				requests: [],
				isProcessing: false,
				lastProcessed: 0
			};
		}
		
		// Safety check - ensure requests array exists
		if (!Array.isArray(c.state.queue.requests)) {
			console.warn(`[ACTOR] Queue requests not initialized in state, initializing now`);
			c.state.queue.requests = [];
		}
		
		// Resume queue processing if there are pending requests
		try {
			if (c.state.queue.requests.some(r => r.status === 'pending')) {
				console.log(`[ACTOR] Found pending requests in queue, resuming processing`);
				updateDebugState(c, "Actor starting", "resuming queue processing");
				startQueueProcessing(c);
			} else {
				updateDebugState(c, "Actor starting", "no pending requests");
			}
		} catch (error) {
			console.error(`[ACTOR] Error checking queue: ${error}`);
			updateDebugState(c, "Actor starting", "error checking queue", undefined, 'failure');
		}
	},

	// Define actions
	actions: {
		/**
		 * Initialize the agent with repository settings
		 */
		initialize: (c) => {
			try {
				updateDebugState(c, "Initializing agent", "loading config");
				
				// Load config from environment variables
				const config = getConfig();

				updateDebugState(c, "Initializing agent", "storing repository settings");
				
				// Store repository settings in state
				c.state.github.owner = config.repoOwner;
				c.state.github.repo = config.repoName;
				c.state.github.baseBranch = config.baseBranch;

				console.log(`[ACTOR] Initialized actor with repository: ${config.repoOwner}/${config.repoName} (${config.baseBranch})`);
				updateDebugState(c, "Initialized agent", `with repository: ${config.repoOwner}/${config.repoName}`);

				return {};
			} catch (error) {
				console.error('[ACTOR] Initialization failed:', error);
				updateDebugState(c, "Initialization failed", error instanceof Error ? error.message : String(error));
				throw error;
			}
		},
		
		/**
		 * Get queue status
		 */
		getQueueStatus: (c) => {
			updateDebugState(c, "Getting queue status", "calculating stats");
			
			const pendingCount = c.state.queue.requests.filter(r => r.status === 'pending').length;
			const processingCount = c.state.queue.requests.filter(r => r.status === 'processing').length;
			const completedCount = c.state.queue.requests.filter(r => r.status === 'completed').length;
			const failedCount = c.state.queue.requests.filter(r => r.status === 'failed').length;
			
			// Determine status emoji
			let statusEmoji = '🤖';
			let statusMessage = 'Bot is idle';
			
			if (c.state.queue.isProcessing) {
				statusEmoji = '👀';
				statusMessage = 'Bot is actively processing requests';
			} else if (pendingCount > 0) {
				statusEmoji = '⏳';
				statusMessage = 'Bot is waiting to process requests';
			} else if (failedCount > 0 && completedCount === 0) {
				statusEmoji = '❌';
				statusMessage = 'Bot encountered errors with all requests';
			} else if (failedCount > 0) {
				statusEmoji = '⚠️';
				statusMessage = 'Bot completed some requests with errors';
			} else if (completedCount > 0) {
				statusEmoji = '✅';
				statusMessage = 'Bot completed all requests successfully';
			}
			
			return {
				pendingCount,
				processingCount,
				completedCount,
				failedCount,
				totalCount: c.state.queue.requests.length,
				isProcessing: c.state.queue.isProcessing,
				lastProcessed: c.state.queue.lastProcessed ? new Date(c.state.queue.lastProcessed).toISOString() : null,
				// Status and emojis
				statusEmoji,
				statusMessage,
				// Include debug info
				debug: {
					...c.state.debug,
					lastUpdatedFormatted: new Date(c.state.debug.lastUpdated).toISOString()
				}
			};
		},

		/**
		 * Handle issue creation event
		 */
		issueCreated: async (c, event: LinearWebhookEvent) => {
			console.log(`[ACTOR] Received issue creation event: ${event.data.id} - ${event.data.title}`);
			updateDebugState(c, "Received issue creation event", `${event.data.title}`, event.data.id);
			
			// Add to queue
			const requestId = enqueueRequest(c, 'issueCreated', event);
			
			return { 
				requestId,
				message: `🤖 Added issue creation event to processing queue (${requestId})`,
				emoji: '🤖'
			};
		},

		/**
		 * Handle comment creation event
		 */
		commentCreated: async (c, event: LinearWebhookEvent) => {
			console.log(`[ACTOR] Received comment creation event: ${event.data.id} on issue ${event.data.issue?.id}`);
			updateDebugState(c, "Received comment creation event", `on issue ${event.data.issue?.id}`, event.data.id);
			
			// Add to queue
			const requestId = enqueueRequest(c, 'commentCreated', event);
			
			return { 
				requestId,
				message: `🤖 Added comment creation event to processing queue (${requestId})`,
				emoji: '🤖'
			};
		},

		/**
		 * Handle issue update event
		 */
		issueUpdated: async (c, event: LinearWebhookEvent) => {
			console.log(`[ACTOR] Received issue update event: ${event.data.id} - New state: ${event.data.state?.name}`);
			updateDebugState(c, "Received issue update event", `New state: ${event.data.state?.name}`, event.data.id);
			
			// Add to queue
			const requestId = enqueueRequest(c, 'issueUpdated', event);
			
			return { 
				requestId,
				message: `🤖 Added issue update event to processing queue (${requestId})`,
				emoji: '🤖'
			};
		},

		/**
		 * Get LLM conversation history
		 */
		getHistory: (c) => {
			console.log(`[ACTOR] Getting conversation history`);
			updateDebugState(c, "Getting history", "retrieving LLM conversation history");
			return c.state.llm.history;
		},
		
		/**
		 * Get debug information
		 */
		getDebug: (c) => {
			console.log(`[ACTOR] Getting debug information`);
			return c.state.debug;
		},
	},
});

