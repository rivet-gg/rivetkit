/**
 * Linear utilities for the coding agent
 */
import { Comment, Issue, LinearClient } from "@linear/sdk";
import { getConfig } from "../../config";
import { Ctx, updateDebugState } from "../coding-agent/mod";
import { IssueStatus, LinearWebhookEvent } from "./types";
import { addBotComment } from "./linear-utils";
import * as github from "./github";
import * as llm from "./llm";

/**
 * Handle new issue created event
 */
export async function handleIssueCreated(
	c: Ctx,
	event: LinearWebhookEvent,
): Promise<void> {
	try {
		const issueId = event.data.id;
		const issueFriendlyId = event.data.identifier;
		updateDebugState(c, "Processing new issue", `received`, issueId);

		// Store issue ID in state
		c.state.linear.issueId = issueId;

		// Set initial status in state and on Linear
		c.state.linear.status = "In Progress";
		const initialStatusResult = await updateIssueStatus(c, issueId, "In Progress");
		
		// Verify that the status update succeeded
		if (initialStatusResult) {
			console.log(`[LINEAR] ✅ Successfully updated issue status to "In Progress"`);
		} else {
			console.error(`[LINEAR] ❌ Failed to update issue status to "In Progress"`);
			// Try one more time after a short delay
			await new Promise(resolve => setTimeout(resolve, 1000));
			await updateIssueStatus(c, issueId, "In Progress");
		}

		console.log(`[LINEAR] New issue created: ${issueId}`);

		// Add an initial comment with eyes emoji to show we're working on it
		await addBotComment(
			c,
			issueId,
			`👀 Starting to work on this issue. I'll analyze your request and implement the necessary changes. Please stand by...`,
			"info",
		);

		// Create a new branch for this issue
		await createBranchForIssue(
			c,
			issueId,
			issueFriendlyId,
			event.data.title ?? "unknown",
		);

		// Fetch the repository file tree
		await fetchFileTree(c);

		// Initialize LLM history if it's empty, or keep existing conversation
		if (c.state.llm.history.length === 0) {
			console.log(`[LINEAR] Initializing new LLM history for new issue`);
		} else {
			console.log(`[LINEAR] Keeping existing LLM history with ${c.state.llm.history.length} messages`);
		}
		
		// Always clear modified files when starting with a new issue
		c.state.code.modifiedFiles = {};

		// Process the issue with LLM
		let prompt = `Title: ${event.data.title}`;
		if (event.data.description)
			prompt += `\nDescription:\n${event.data.description}`;
		await processIssueWithLLM(c, prompt);
		
		// Check if there are any modified files
		const modifiedFilesCount = Object.keys(c.state.code.modifiedFiles).length;
		if (modifiedFilesCount > 0) {
			// Create PR for the changes
			await createPRForIssue(
				c,
				issueId,
				issueFriendlyId,
				event.data.title ?? "unknown",
				event.data.description ?? "unknown",
			);
			
			// Update status to In Review
			console.log(`[LINEAR] Changing issue status to "In Review" after completing implementation`);
			c.state.linear.status = "In Review";
			const reviewStatusResult = await updateIssueStatus(c, issueId, "In Review");
			
			// Verify that the status update succeeded
			if (reviewStatusResult) {
				console.log(`[LINEAR] ✅ Successfully updated issue status to "In Review"`);
			} else {
				console.error(`[LINEAR] ❌ Failed to update issue status to "In Review"`);
				
				// Log current status for debugging
				const currentStatus = await getIssueStatus(c, issueId);
				console.log(`[LINEAR] Current issue status is: ${currentStatus}`);
				
				// Try one more time after a short delay
				console.log(`[LINEAR] Trying status update again after a short delay...`);
				
				// Wait 1 second and try again
				await new Promise(resolve => setTimeout(resolve, 1000));
				const secondAttemptResult = await updateIssueStatus(c, issueId, "In Review");
				
				if (secondAttemptResult) {
					console.log(`[LINEAR] ✅ Second attempt to update status succeeded`);
				} else {
					console.error(`[LINEAR] ❌ Second attempt to update status also failed`);
				}
			}
			
			// Add a comment to confirm status change
			await addBotComment(
				c,
				issueId,
				`✅ I've processed your issue and created a PR. The status has been changed to "In Review".`,
				"success"
			);
		} else {
			console.log(`[LINEAR] No files were modified during processing`);
			await addBotComment(
				c,
				issueId,
				`⚠️ I processed your issue but no files were modified. Please provide more details or clarify the request.`,
				"info"
			);
		}
	} catch (error) {
		console.error(`[LINEAR] Failed to process issue creation:`, error);
		updateDebugState(
			c,
			"Failed to process issue",
			error instanceof Error ? error.message : String(error),
			undefined,
			"failure",
		);

		// Attempt to add a comment about the error
		try {
			if (c.state.linear.issueId) {
				await addBotComment(
					c,
					c.state.linear.issueId,
					`I encountered an error while processing this issue: ${error instanceof Error ? error.message : String(error)}\n\nPlease try again or contact support.`,
					"failure",
				);
			}
		} catch (commentError) {
			console.error(`[LINEAR] Failed to add error comment:`, commentError);
		}
	}
}

/**
 * Handle new comment created event
 */
export async function handleCommentCreated(
	c: Ctx,
	event: LinearWebhookEvent,
): Promise<void> {
	try {
		// Detailed debug logging for webhook payload
		console.log(`[LINEAR] Comment webhook payload:`, JSON.stringify(event.data));
		
		// Skip if no issue or this is a bot comment
		if (!event.data.issue) {
			console.log(`[LINEAR] ⚠️ Skipping comment - no issue reference found in the event data`);
			return;
		}
		
		// Check if comment is from a bot user
		if (event.data.user?.isBot) {
			console.log(`[LINEAR] ⚠️ Skipping comment from bot user - preventing feedback loop`);
			return;
		}
		
		// Check if comment starts with a bot emoji (✅, ❌, 🤖)
		// This catches comments created by our bot even if the isBot flag isn't set
		if (event.data.body && (event.data.body.startsWith('✅') || 
		                        event.data.body.startsWith('❌') || 
		                        event.data.body.startsWith('🤖'))) {
			console.log(`[LINEAR] ⚠️ Skipping comment that starts with bot emoji: "${event.data.body.substring(0, 20)}..."`);
			return;
		}

		const issueId = event.data.issue.id;
		const commentId = event.data.id;
		const commentBody = event.data.body || "(empty comment)";

		updateDebugState(c, "Processing new comment", `received: "${commentBody.substring(0, 50)}${commentBody.length > 50 ? '...' : ''}"`, commentId);
		console.log(`[LINEAR] New comment on issue ${issueId}: ${commentId} - Content: "${commentBody.substring(0, 100)}${commentBody.length > 100 ? '...' : ''}"`);

		// Store issue ID in state if not already stored
		if (!c.state.linear.issueId) {
			c.state.linear.issueId = issueId;
			console.log(`[LINEAR] Setting issue ID in state: ${issueId}`);
		}

		// Check the current issue status
		const currentStatus = await getIssueStatus(c, issueId);
		console.log(`[LINEAR] Current issue status: ${currentStatus}`);
		
		// Only process comments requesting changes if the issue is in review state
		if (currentStatus !== "In Review") {
			console.log(`[LINEAR] ⚠️ Issue status is "${currentStatus}", not processing comment as changes can only be requested during review.`);
			await addBotComment(
				c,
				issueId,
				`I can't process changes when the issue is in the "${currentStatus}" state. Comments requesting changes are only processed when the issue is in the "In Review" state.`,
				"info",
			);
			return;
		}

		// Update the issue status back to "In Progress" when working on a comment
		console.log(`[LINEAR] Changing issue status to "In Progress" to work on the comment`);
		c.state.linear.status = "In Progress";
		const commentStatusResult = await updateIssueStatus(c, issueId, "In Progress");
		
		// Verify that the status update succeeded
		if (commentStatusResult) {
			console.log(`[LINEAR] ✅ Successfully updated issue status to "In Progress"`);
		} else {
			console.error(`[LINEAR] ❌ Failed to update issue status to "In Progress"`);
			// Try one more time after a short delay
			await new Promise(resolve => setTimeout(resolve, 1000));
			await updateIssueStatus(c, issueId, "In Progress");
		}

		// Clear any previously modified files to start fresh
		console.log(`[LINEAR] Clearing ${Object.keys(c.state.code.modifiedFiles).length} previously modified files from state`);
		c.state.code.modifiedFiles = {};

		// Fetch the repository file tree to make sure it's up to date
		await fetchFileTree(c);

		// Add a comment to acknowledge the request
		await addBotComment(
			c,
			issueId,
			`👀 I'm working on your comment. I'll analyze it and make the requested changes. Please stand by...`,
			"info",
		);

		// We want to keep the LLM history for context continuity
		// Just log the current history size for debugging
		console.log(`[LINEAR] Continuing LLM conversation with ${c.state.llm.history.length} existing messages`);

		// Keep the progress comment ID to allow real-time updates
		// This lets the user see step-by-step progress for follow-up requests too

		// Process the comment with LLM
		await processIssueWithLLM(c, event.data.body ?? "unknown");
		
		// Check if there are modified files to commit
		const modifiedFilesCount = Object.keys(c.state.code.modifiedFiles).length;
		if (modifiedFilesCount > 0) {
			// Commit the changes to GitHub
			console.log(`[LINEAR] Committing ${modifiedFilesCount} modified files to GitHub`);
			const issueFriendlyId = event.data.issue?.id || "unknown";
			const commitMessage = `Update implementation for ${issueFriendlyId} based on feedback`;
			
			// Create a commit for the changes
			await github.commitChanges(
				c,
				c.state.code.modifiedFiles,
				c.state.github.branchName,
				commitMessage
			);
			
			// Reset the modified files state after committing
			c.state.code.modifiedFiles = {};
			
			console.log(`[LINEAR] Successfully committed changes to GitHub`);
		} else {
			console.log(`[LINEAR] No files were modified during processing`);
		}

		// Change status back to "In Review" after processing
		console.log(`[LINEAR] Changing issue status back to "In Review" after processing the comment`);
		c.state.linear.status = "In Review";
		const finishStatusResult = await updateIssueStatus(c, issueId, "In Review");
		
		// Verify that the status update succeeded
		if (finishStatusResult) {
			console.log(`[LINEAR] ✅ Successfully updated issue status to "In Review"`);
		} else {
			console.error(`[LINEAR] ❌ Failed to update issue status to "In Review"`);
			
			// Log current status for debugging
			const currentStatus = await getIssueStatus(c, issueId);
			console.log(`[LINEAR] Current issue status is: ${currentStatus}`);
			
			// Try one more time after a short delay
			console.log(`[LINEAR] Trying status update again after a short delay...`);
			
			// Wait 1 second and try again
			await new Promise(resolve => setTimeout(resolve, 1000));
			const secondAttemptResult = await updateIssueStatus(c, issueId, "In Review");
			
			if (secondAttemptResult) {
				console.log(`[LINEAR] ✅ Second attempt to update status succeeded`);
			} else {
				console.error(`[LINEAR] ❌ Second attempt to update status also failed`);
			}
		}

		// Add a comment to indicate completion
		await addBotComment(
			c,
			issueId,
			`✅ I've processed your comment and pushed the changes to the branch. Please review!`,
			"success",
		);
	} catch (error) {
		console.error(`[LINEAR] Failed to process comment creation:`, error);
		updateDebugState(
			c,
			"Failed to process comment",
			error instanceof Error ? error.message : String(error),
			undefined,
			"failure",
		);

		// Attempt to add a comment about the error
		try {
			if (c.state.linear.issueId) {
				await addBotComment(
					c,
					c.state.linear.issueId,
					`I encountered an error while processing your comment: ${error instanceof Error ? error.message : String(error)}\n\nPlease try again or contact support.`,
					"failure",
				);
			}
		} catch (commentError) {
			console.error(`[LINEAR] Failed to add error comment:`, commentError);
		}
	}
}

/**
 * Handle issue updated event
 */
export async function handleIssueUpdated(
	c: Ctx,
	event: LinearWebhookEvent,
): Promise<void> {
	try {
		const issueId = event.data.id;

		// Skip if there's no state change
		if (!event.data.state) {
			console.log(`[LINEAR] Skipping issue update (no state change)`);
			return;
		}

		// Get the new status name
		const newStatus = event.data.state?.name as IssueStatus;
		console.log(`[LINEAR] Issue ${issueId} status changed to: ${newStatus}`);

		// No longer checking if the status change was triggered by this bot
		// We'll treat all status changes as external
		updateDebugState(
			c,
			"Processing status update",
			`changed to ${newStatus}`,
			issueId,
		);

		// Store issue ID and status in state
		c.state.linear.issueId = issueId;
		c.state.linear.status = newStatus;

		// Handle based on new status
		if (newStatus === "Done") {
			// Issue is Done, merge the PR if we have one
			if (c.state.github.prInfo) {
				console.log(
					`[LINEAR] Issue is Done, merging PR #${c.state.github.prInfo.number}`,
				);

				// Merge the PR
				await github.mergePullRequest(c, c.state.github.prInfo.number);

				// Add a comment about the merge
				await addBotComment(
					c,
					issueId,
					`✅ The pull request has been merged as the issue is now marked as Done.`,
					"success",
				);
			} else {
				console.log(`[LINEAR] Issue is Done but no PR exists to merge`);
			}
		} else if (newStatus === "Canceled") {
			// Cancel any ongoing LLM process first
			if (c.vars.llmAbortController) {
				console.log(
					`[LINEAR] Cancelling ongoing LLM request due to status change to ${newStatus}`,
				);
				c.vars.llmAbortController.abort();
				c.vars.llmAbortController = undefined;
			}

			// Issue is canceled, close the PR if we have one
			if (c.state.github.prInfo && c.state.github.prInfo.number) {
				console.log(
					`[LINEAR] Issue is canceled, closing PR #${c.state.github.prInfo.number}`,
				);

				// Close the PR
				await github.closePullRequest(c, c.state.github.prInfo.number);

				// Add a comment about closing the PR
				await addBotComment(
					c,
					issueId,
					`❌ The pull request has been closed as the issue is now marked as Canceled.`,
					"info",
				);
			} else {
				console.log(`[LINEAR] Issue is canceled but no PR exists to close`);
			}
		}
	} catch (error) {
		console.error(`[LINEAR] Failed to process issue update:`, error);
		updateDebugState(
			c,
			"Failed to process status update",
			error instanceof Error ? error.message : String(error),
			undefined,
			"failure",
		);
	}
}

/**
 * Create a new branch for an issue
 */
async function createBranchForIssue(
	c: Ctx,
	issueId: string,
	issueFriendlyId: string,
	title: string,
): Promise<void> {
	try {
		// Create a branch name from issue ID and title
		const formattedTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
		const branchName = `issue-${issueFriendlyId.toLowerCase()}-${formattedTitle.substring(0, 30)}`;

		updateDebugState(c, "Creating branch", branchName, issueFriendlyId);
		console.log(`[LINEAR] Creating branch: ${branchName}`);

		// Create branch in GitHub
		await github.createBranch(c, branchName, c.state.github.baseBranch);

		// Store the branch name in state
		c.state.github.branchName = branchName;

		// Add a comment about the branch creation
		await addBotComment(
			c,
			issueId,
			`Created a new branch \`${branchName}\` for this issue.`,
			"info",
		);

		console.log(`[LINEAR] Branch created successfully`);
	} catch (error) {
		console.error(`[LINEAR] Failed to create branch:`, error);
		updateDebugState(
			c,
			"Failed to create branch",
			error instanceof Error ? error.message : String(error),
			undefined,
			"failure",
		);
		throw error;
	}
}

/**
 * Fetch repository file tree
 */
async function fetchFileTree(c: Ctx): Promise<void> {
	try {
		updateDebugState(c, "Fetching files", "Getting repository file tree");
		console.log(`[LINEAR] Fetching file tree from GitHub`);

		// Get file tree from GitHub
		c.state.code.fileTree = await github.getFileTree(
			c,
			c.state.github.branchName,
		);

		console.log(
			`[LINEAR] File tree fetched successfully: ${c.state.code.fileTree.length} files`,
		);
	} catch (error) {
		console.error(`[LINEAR] Failed to fetch file tree:`, error);
		updateDebugState(
			c,
			"Failed to fetch files",
			error instanceof Error ? error.message : String(error),
			undefined,
			"failure",
		);
		throw error;
	}
}

/**
 * Process an issue with LLM
 */
async function processIssueWithLLM(c: Ctx, prompt: string): Promise<void> {
	try {
		updateDebugState(
			c,
			"Processing issue",
			"generating code with LLM",
			c.state.linear.issueId,
		);
		console.log(`[LINEAR] Processing issue with LLM`);

		// Process with LLM
		await llm.processWithLLM(c, prompt);

		console.log(`[LINEAR] LLM processing completed`);
	} catch (error) {
		console.error(`[LINEAR] Failed to process with LLM:`, error);
		updateDebugState(
			c,
			"Failed to process with LLM",
			error instanceof Error ? error.message : String(error),
			undefined,
			"failure",
		);
		throw error;
	}
}

/**
 * Create a PR for the issue
 */
async function createPRForIssue(
	c: Ctx,
	issueId: string,
	issueFriendlyId: string,
	title: string,
	description: string,
): Promise<void> {
	try {
		updateDebugState(
			c,
			"Creating PR",
			"Creating pull request",
			issueFriendlyId,
		);
		console.log(`[LINEAR] Creating PR for issue ${issueId}`);

		// Check if we have any modified files
		const modifiedFilesCount = Object.keys(c.state.code.modifiedFiles).length;
		if (modifiedFilesCount === 0) {
			console.log(`[LINEAR] No files modified, skipping PR creation`);
			await addBotComment(
				c,
				issueId,
				`No files were modified during processing, so no PR was created.`,
				"info",
			);
			return;
		}

		// First commit the changes
		await github.commitChanges(
			c,
			c.state.code.modifiedFiles,
			c.state.github.branchName,
			`Implement changes for ${issueFriendlyId}: ${title}`,
		);

		// Generate a summary of the changes
		const summary = await llm.generateChangeSummary(c, description);

		// Create PR
		c.state.github.prInfo = await github.createPullRequest(
			c,
			`${title}`, // Just use the issue title
			`Closes ${issueFriendlyId}\n\nImplements changes requested in Linear issue.\n\n${summary}\n\n*Authored by ActorCore Coding Agent*`, // Include "Closes" keyword
			c.state.github.branchName,
			c.state.github.baseBranch,
		);

		console.log(
			`[LINEAR] PR created successfully: #${c.state.github.prInfo?.number}`,
		);

		// Add a comment with the PR link
		await addBotComment(
			c,
			issueId,
			`✅ Created PR #${c.state.github.prInfo?.number}: ${c.state.github.prInfo?.url}\n\nSummary of changes:\n${summary}`,
			"success",
		);
	} catch (error) {
		console.error(`[LINEAR] Failed to create PR:`, error);
		updateDebugState(
			c,
			"Failed to create PR",
			error instanceof Error ? error.message : String(error),
			undefined,
			"failure",
		);
		throw error;
	}
}

/**
 * Update an issue's status
 */
export async function updateIssueStatus(
	c: Ctx,
	issueId: string,
	status: IssueStatus,
): Promise<boolean> {
	try {
		updateDebugState(c, "Updating issue status", `to ${status}`, issueId);
		console.log(`[LINEAR] Updating issue ${issueId} status to: ${status}`);

		const config = getConfig();
		const client = new LinearClient({ apiKey: config.linearApiKey });

		// Get the organization's workflow states
		const workflowStates = await client.workflowStates();
		
		// Log all available workflow states for debugging
		console.log(`[LINEAR] Available workflow states: ${workflowStates.nodes.map(state => state.name).join(', ')}`);

		// Find the matching state by name
		const statusState = workflowStates.nodes.find(
			(state) => state.name === status,
		);

		if (!statusState) {
			console.error(`[LINEAR] 🚨 Error: Could not find workflow state for status: "${status}"`);
			console.error(`[LINEAR] Available states are: ${workflowStates.nodes.map(state => `"${state.name}"`).join(', ')}`);
			throw new Error(`Could not find workflow state for status: ${status}`);
		}

		console.log(`[LINEAR] Found matching workflow state: ${statusState.name} (${statusState.id})`);

		// Update the issue with the new status
		const issue = await client.issue(issueId);
		
		// Log current state before updating
		const currentState = await issue.state;
		console.log(`[LINEAR] Current issue state before update: ${currentState?.name || 'unknown'}`);
		
		// Perform the update
		const updateResult = await issue.update({ stateId: statusState.id });
		console.log(`[LINEAR] Update result:`, updateResult);

		// No longer recording bot-initiated changes
		console.log(`[LINEAR] Changed issue status to: ${status}`);

		return true;
	} catch (error) {
		console.error(`[LINEAR] 🚨 Failed to update issue ${issueId} status to "${status}":`, error);
		if (error instanceof Error) {
			console.error(`[LINEAR] Error details: ${error.message}`);
			if (error.stack) {
				console.error(`[LINEAR] Stack trace: ${error.stack}`);
			}
		}
		return false;
	}
}

/**
 * Get the current status of an issue
 */
export async function getIssueStatus(
	c: Ctx,
	issueId: string,
): Promise<IssueStatus | null> {
	try {
		console.log(`[LINEAR] Getting status for issue ${issueId}`);

		const config = getConfig();
		const client = new LinearClient({ apiKey: config.linearApiKey });

		// Get the issue
		const issue = await client.issue(issueId);

		// Get the status name safely
		let statusName: IssueStatus = "Unknown";
		const state = await issue.state;
		if (state?.name) {
			statusName = state.name;
		}

		console.log(`[LINEAR] Issue ${issueId} status: ${statusName}`);

		return statusName;
	} catch (error) {
		console.error(`[LINEAR] Failed to get issue status:`, error);
		return null;
	}
}