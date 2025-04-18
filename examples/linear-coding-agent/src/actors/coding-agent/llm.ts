import { generateText, tool } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import {
	CoreAssistantMessage,
	CoreSystemMessage,
	CoreToolMessage,
	CoreUserMessage,
} from "ai";
import { z } from "zod";
import type { GitHubFile, LLMToolResult } from "./types";
import { Ctx } from "./mod";
import * as github from "./github";
import { addBotComment, updateBotComment, formatLLMMessagesForComment } from "./linear-utils";

// Type alias using AI SDK's native message types
export type LLMMessage =
	| CoreSystemMessage
	| CoreUserMessage
	| CoreAssistantMessage
	| CoreToolMessage;
import { getConfig } from "../../config";

/**
 * Process issue/comment with LLM
 */
export async function processWithLLM(c: Ctx, prompt: string) {
	// Cancel any existing LLM request first
	if (c.vars.llmAbortController) {
		console.log(
			"[LLM] Cancelling existing LLM request before starting a new one",
		);
		c.vars.llmAbortController.abort();
		c.vars.llmAbortController = undefined;
	}

	console.log(
		`[LLM] Starting processing with prompt length: ${prompt.length} chars`,
	);

	// For follow-up requests, we want to continue updating the same comment
	// to show real-time progress, just like the first request
	if (c.state.linear.llmProgressCommentId) {
		console.log(
			"[LLM] Using existing progress comment ID for real-time updates:", 
			c.state.linear.llmProgressCommentId
		);
	} else {
		console.log("[LLM] No existing progress comment ID - will create a new one");
	}

	// Create tool handlers using context
	const toolHandlers = createToolHandlers(c, async (path, branch) => {
		return await github.readFile(c, path, branch);
	});

	// Process the issue with LLM
	try {
		await processIssue(c, prompt, toolHandlers);

		console.log(
			`[LLM] Processing completed successfully. Modified files: ${Object.keys(c.state.code.modifiedFiles).length}`,
		);

		return { success: true };
	} catch (error) {
		console.error("[LLM] Processing failed:", error);
		return { success: false };
	}
}

/**
 * Interface for tool handlers to be used with LLM
 */
export interface ToolHandlers {
	listFileTree: () => Promise<LLMToolResult>;
	readFiles: (paths: string[]) => Promise<LLMToolResult>;
	modifyFiles: (files: Record<string, string>) => Promise<LLMToolResult>;
}

/**
 * Create handler functions for LLM tools using context
 */
export function createToolHandlers(
	c: Ctx,
	readFileFn: (
		path: string,
		branch: string,
	) => Promise<{ content: string } | null>,
): ToolHandlers {
	return {
		// Handler for listing file tree
		listFileTree: async (): Promise<LLMToolResult> => {
			console.log("[LLM] Tool called: listFileTree");
			return {
				success: true,
				result: c.state.code.fileTree,
			};
		},

		// Handler for reading files
		readFiles: async (paths: string[]): Promise<LLMToolResult> => {
			console.log(`[LLM] Tool called: readFiles (${paths.length} files)`);
			const result: Record<string, string | null> = {};

			for (const path of paths) {
				// First check if we have a modified version in state
				if (path in c.state.code.modifiedFiles) {
					result[path] = c.state.code.modifiedFiles[path];
					continue;
				}

				// Otherwise read from GitHub
				const fileContent = await readFileFn(path, c.state.github.branchName);
				if (fileContent) {
					result[path] = fileContent.content;
				} else {
					result[path] = null;
				}
			}

			return {
				success: true,
				result,
			};
		},

		// Handler for modifying files
		modifyFiles: async (
			files: Record<string, string>,
		): Promise<LLMToolResult> => {
			console.log(
				`[LLM] Tool called: modifyFiles (${Object.keys(files).length} files)`,
			);
			// Update state with the modified files
			for (const [path, content] of Object.entries(files)) {
				c.state.code.modifiedFiles[path] = content;
			}

			return {
				success: true,
				result: { modifiedFiles: Object.keys(files) },
			};
		},
	};
}

/**
 * Define all tools as raw Vercel AI tools
 */
export function createTools(handlers: ToolHandlers) {
	return {
		listFileTree: tool({
			description: "List the file structure of the repository",
			parameters: z.object({}),
			execute: async () => {
				const result = await handlers.listFileTree();
				if (!result.success) {
					throw new Error(result.error || "Unknown error from listFileTree");
				}
				return JSON.stringify(result.result);
			},
		}),
		
		readFiles: tool({
			description: "Read the contents of specified files",
			parameters: z.object({
				paths: z.array(z.string()).describe("Array of file paths to read"),
			}),
			execute: async ({ paths }) => {
				const result = await handlers.readFiles(paths);
				if (!result.success) {
					throw new Error(result.error || "Unknown error from readFiles");
				}
				return JSON.stringify(result.result);
			},
		}),
		
		modifyFiles: tool({
			description: "Modify the contents of specified files",
			parameters: z.object({
				files: z
					.record(z.string())
					.describe("Object mapping file paths to their new contents"),
			}),
			execute: async ({ files }) => {
				const result = await handlers.modifyFiles(files);
				if (!result.success) {
					throw new Error(result.error || "Unknown error from modifyFiles");
				}
				return JSON.stringify(result.result);
			},
		}),
	};
}

/**
 * System message for coding agent
 */
export const CODING_AGENT_SYSTEM_MESSAGE = `You are an expert software engineer tasked with implementing code changes based on Linear issue descriptions. 
You have access to a GitHub repository and can view and modify files. Make the minimal necessary changes to 
correctly implement the requirements in the issue. Focus on writing clean, maintainable code that follows 
the project's style and best practices. You will be given tools to explore the codebase and make changes.`;

/**
 * Generate code changes based on a Linear issue
 */
export async function processIssue(
	c: Ctx,
	prompt: string,
	toolHandlers: ToolHandlers,
): Promise<void> {
	// Initialize variables to track success
	let success = true;
	let lastError: string | null = null;

	try {
		const config = getConfig();
		console.log("[LLM] Setting up model and tools");

		// Setup AI model
		const aiModel = anthropic("claude-3-7-sonnet-20250219");

		// Create tools using the new simplified approach
		const tools = createTools(toolHandlers);

		// Create a new abort controller and store it in vars
		const abortController = new AbortController();
		c.vars.llmAbortController = abortController;

		// If starting a new conversation, add the system message and create initial user message
		let userMessage = prompt;
		if (c.state.llm.history.length === 0) {
			console.log("[LLM] Starting new conversation");

			// Add system message to conversation history
			c.state.llm.history.push({
				role: "system",
				content: CODING_AGENT_SYSTEM_MESSAGE,
			});

			// Create a more detailed prompt for new conversations
			userMessage = `I need you to implement the following Linear issue:\n\n${prompt}\n\nPlease start by exploring the codebase to understand its structure, then make the necessary changes to implement this feature.`;
		} else {
			console.log(
				`[LLM] Continuing conversation with ${c.state.llm.history.length} messages`,
			);
		}

		// Add user message to conversation history
		c.state.llm.history.push({
			role: "user",
			content: userMessage,
		});

		// Create message array for LLM request
		const conversationMessages = [...c.state.llm.history];

		console.log(
			`[LLM] Sending request to Claude (${conversationMessages.length} messages)`,
		);

		// Use Vercel AI SDK's generateText with our tools
		const startTime = Date.now();
		const { response } = await generateText({
			model: aiModel,
			messages: conversationMessages,
			tools,
			abortSignal: abortController.signal,
			maxSteps: 32,
			maxTokens: 64_000,
			onStepFinish: async ({ response }) => {
				// Get the current history length to determine which messages are new
				const currentHistoryLength = c.state.llm.history.length;

				// Only add messages that aren't already in the history (new messages)
				const newMessages = response.messages.slice(currentHistoryLength);

				console.log(
					`👀 [LLM] Step finished (${response.messages.length} total messages, ${newMessages.length} new)`,
				);

				if (newMessages.length > 0) {
					console.log(
						`👀 [LLM] Adding ${newMessages.length} new messages to history (${newMessages.map((m) => m.role).join(",")})`,
					);
					c.state.llm.history.push(...newMessages);

					// Update the progress comment with all messages
					try {
						// Format the entire history into a readable comment
						const commentText = formatLLMMessagesForComment(c.state.llm.history);
						
						// If we already have a comment ID, update that comment
						if (c.state.linear.llmProgressCommentId && typeof c.state.linear.llmProgressCommentId === 'string' && c.state.linear.llmProgressCommentId.length > 0) {
							console.log(`👀 [LLM] Updating existing progress comment ${c.state.linear.llmProgressCommentId}`);
							const updateResult = await updateBotComment(
								c.state.linear.llmProgressCommentId,
								`AI is working on your request:\n\n${commentText}`,
								"info"
							);
							
							if (!updateResult) {
								console.log(`⚠️ [LLM] Failed to update comment, will create a new one`);
								// If update fails, try creating a new comment
								const newResult = await addBotComment(
									c,
									c.state.linear.issueId,
									`AI is working on your request:\n\n${commentText}`,
									"info"
								);
								
								if (newResult.success && newResult.commentId && typeof newResult.commentId === 'string' && newResult.commentId.length > 0) {
									c.state.linear.llmProgressCommentId = newResult.commentId;
									console.log(`👀 [LLM] Saved new progress comment ID: ${newResult.commentId}`);
								} else {
									console.warn(`⚠️ [LLM] Got invalid replacement comment ID from Linear: ${newResult.commentId}`);
								}
							}
						} else {
							// Otherwise, create a new comment and save its ID
							console.log(`👀 [LLM] Creating new progress comment`);
							const result = await addBotComment(
								c,
								c.state.linear.issueId,
								`AI is working on your request:\n\n${commentText}`,
								"info"
							);
							
							if (result.success && result.commentId && typeof result.commentId === 'string' && result.commentId.length > 0) {
								// Make sure we're setting a valid string ID
								c.state.linear.llmProgressCommentId = result.commentId;
								console.log(`👀 [LLM] Saved progress comment ID: ${result.commentId}`);
							} else {
								console.warn(`⚠️ [LLM] Got invalid comment ID from Linear: ${result.commentId}`);
							}
						}
					} catch (error) {
						console.error(
							`[LLM] Failed to update progress comment: ${error}`,
						);
					}
				}
			},
		});
		const duration = Date.now() - startTime;

		console.log(
			`[LLM] Received response (${response.messages.length} ${response.messages.map((x) => x.role).join(",")} messages) in ${duration}ms`,
		);

		// Update the progress comment with completion message
		try {
			// Format the entire history into a readable comment
			const commentText = formatLLMMessagesForComment(c.state.llm.history);
			
			if (c.state.linear.llmProgressCommentId && typeof c.state.linear.llmProgressCommentId === 'string' && c.state.linear.llmProgressCommentId.length > 0) {
				// Update the existing comment
				console.log(`👀 [LLM] Updating progress comment with completion status: ${c.state.linear.llmProgressCommentId}`);
				const updateResult = await updateBotComment(
					c.state.linear.llmProgressCommentId,
					`AI has finished processing your request:\n\n${commentText}\n\n✅ Processing complete - preparing results...`,
					"success"
				);
				
				if (!updateResult) {
					console.log(`⚠️ [LLM] Failed to update completion comment, will create a new one`);
					// If update fails, create a new comment
					await addBotComment(
						c,
						c.state.linear.issueId,
						`AI has finished processing your request:\n\n${commentText}\n\n✅ Processing complete - preparing results...`,
						"success"
					);
				}
			} else {
				// If no comment ID exists (rare case), create a new one
				console.log(`👀 [LLM] Creating completion comment`);
				await addBotComment(
					c,
					c.state.linear.issueId,
					`AI has finished processing your request:\n\n${commentText}\n\n✅ Processing complete - preparing results...`,
					"success"
				);
			}
		} catch (error) {
			console.error(
				`[LLM] Failed to update completion comment: ${error}`,
			);
		}

		// Count tool calls
		let toolCallCount = 0;
		response.messages.forEach((msg) => {
			if (
				msg.role === "assistant" &&
				"tool_calls" in msg &&
				Array.isArray(msg.tool_calls)
			) {
				toolCallCount += msg.tool_calls.length || 0;
			}
		});

		if (toolCallCount > 0) {
			console.log(`[LLM] Used ${toolCallCount} tool calls during processing`);
		}
	} catch (error: unknown) {
		// Check if this was an abort error
		if (error instanceof Error && error.name === "AbortError") {
			console.warn("[LLM] Processing was aborted");
			success = false;
			lastError = "Request was aborted";
		} else {
			console.error("[LLM] Error in service:", error);
			success = false;
			lastError = error instanceof Error ? error.message : String(error);

			// If there was an error, inform the LLM about it
			if (lastError) {
				console.log("[LLM] Adding error message to conversation history");
				c.state.llm.history.push({
					role: "user",
					content: `There was an error in your implementation: ${lastError}. Please fix it and try again.`,
				});
			}
		}
	}

	// Clear the abort controller
	c.vars.llmAbortController = undefined;
	console.log(`[LLM] Processing finished, success: ${success}`);
}

/**
 * Generate a summary of the changes made
 */
export async function generateChangeSummary(
	c: Ctx,
	issueDescription: string,
): Promise<string> {
	// Cancel any existing LLM request first
	if (c.vars.llmAbortController) {
		console.log(
			"[LLM] Cancelling existing LLM request before generating summary",
		);
		c.vars.llmAbortController.abort();
		c.vars.llmAbortController = undefined;
	}

	console.log("[LLM] Generating change summary");

	// Create a new abort controller and store it in vars
	const abortController = new AbortController();
	c.vars.llmAbortController = abortController;

	const modifiedFilePaths = Object.keys(c.state.code.modifiedFiles);
	const config = getConfig();

	// Set API key through environment variable
	const aiModel = anthropic("claude-3-7-sonnet-20250219");

	try {
		// Define system message for change summary
		const SUMMARY_SYSTEM_MESSAGE =
			"You are a helpful assistant that summarizes code changes made to implement a feature. Provide a concise technical summary followed by a brief impact statement.";

		console.log(
			`[LLM] Requesting change summary for ${modifiedFilePaths.length} files`,
		);

		// Use Vercel AI SDK's generateText for change summary
		const startTime = Date.now();
		const summary = await generateText({
			model: aiModel,
			messages: [
				{ role: "system", content: SUMMARY_SYSTEM_MESSAGE },
				{
					role: "user",
					content: `I've implemented the following Linear issue:\n\n${issueDescription}\n\nI modified these files: ${modifiedFilePaths.join(", ")}. Please provide a concise summary of the changes that were likely made to implement this feature. Keep it brief and technical, focusing on what was accomplished.`,
				},
			],
			temperature: 0.7, // Add a bit of temperature for more natural-sounding summaries
			abortSignal: abortController.signal,
		});
		const duration = Date.now() - startTime;

		console.log(`[LLM] Summary generated in ${duration}ms`);

		// Clear the controller after successful completion
		c.vars.llmAbortController = undefined;

		return summary.text;
	} catch (error: unknown) {
		// Handle abortion or other errors
		if (error instanceof Error && error.name === "AbortError") {
			console.warn("[LLM] Summary generation was aborted");
			return "Generation aborted";
		}

		console.error("[LLM] Error generating summary:", error);
		return "Error generating summary";
	}
}
