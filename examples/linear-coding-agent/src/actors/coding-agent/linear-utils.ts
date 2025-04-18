/**
 * Utility functions for Linear integration
 */
import { LinearClient } from "@linear/sdk";
import { getConfig } from "../../config";
import { Ctx } from "./mod";
import { LLMMessage } from "./llm";

/**
 * Add a comment to a Linear issue with appropriate bot indicators
 *
 * @param c Actor context
 * @param issueId Linear issue ID
 * @param comment Comment text to add
 * @param status Optional status indicator (success, failure, or info)
 * @returns Promise resolving to true if comment was added successfully, false otherwise
 */
export async function addBotComment(
	c: Ctx,
	issueId: string,
	comment: string,
	status: "success" | "failure" | "info" = "info",
): Promise<{ success: boolean; commentId?: string }> {
	try {
		const config = getConfig();
		const client = new LinearClient({ apiKey: config.linearApiKey });

		// Get the issue
		const issue = await client.issue(issueId);

		// Add emoji based on status
		let statusEmoji = "🤖"; // Default bot indicator
		if (status === "success") {
			statusEmoji = "✅";
		} else if (status === "failure") {
			statusEmoji = "❌";
		}

		// Create formatted comment with emoji and unique bot identifier
		const formattedComment = `${statusEmoji} **Bot Update**: ${comment}`;
		
		console.log(`📝 [LINEAR] Adding bot comment to issue ${issueId}: ${formattedComment.substring(0, 100)}${formattedComment.length > 100 ? '...' : ''}`);

		// Create a comment via the Linear API
		const createdComment = await client.createComment({
			issueId: issue.id,
			body: formattedComment,
		});
		const commentData = await createdComment.comment;
		const commentId = commentData?.id;

		if (!commentId) {
			console.warn(
				`No comment ID returned from Linear API: ${JSON.stringify(createdComment)}`,
			);
		} else {
			console.log(`📝 [LINEAR] Successfully added comment with ID: ${commentId}`);
		}

		return { success: true, commentId };
	} catch (error) {
		console.error(`Failed to add comment to issue ${issueId}:`, error);
		return { success: false };
	}
}

/**
 * Update an existing comment with new content
 *
 * @param commentId ID of the comment to update
 * @param comment New comment text to set
 * @param status Optional status indicator (success, failure, or info)
 * @returns Promise resolving to true if comment was updated successfully, false otherwise
 */
export async function updateBotComment(
	commentId: string,
	comment: string,
	status: "success" | "failure" | "info" = "info",
): Promise<boolean> {
	try {
		const config = getConfig();
		const client = new LinearClient({ apiKey: config.linearApiKey });

		// Add emoji based on status
		let statusEmoji = "🤖"; // Default bot indicator
		if (status === "success") {
			statusEmoji = "✅";
		} else if (status === "failure") {
			statusEmoji = "❌";
		}

		// Create formatted comment with emoji
		const formattedComment = `${statusEmoji} **Bot Update**: ${comment}`;
		
		console.log(`📝 [LINEAR] Updating bot comment ${commentId}: ${formattedComment.substring(0, 100)}${formattedComment.length > 100 ? '...' : ''}`);

		// Use the Linear SDK to update the comment
		const result = await client.updateComment(commentId, {
			body: formattedComment,
		});

		console.log(`📝 [LINEAR] Comment update result:`, result);

		return result.success || false;
	} catch (error) {
		console.error(`Failed to update comment ${commentId}:`, error);
		console.error(`Error details:`, error);
		return false;
	}
}

const TRUNCATE_LENGTH = 200;

/**
 * Format LLM messages into a readable comment
 *
 * @param messages LLM conversation messages
 * @returns Formatted comment text
 */
export function formatLLMMessagesForComment(messages: LLMMessage[]): string {
	const parts: string[] = [];

	for (const message of messages) {
		if (!message || !message.role) continue;

		if (message.role === "system") {
			// Skip system messages for brevity
			continue;
		}

		if (message.role === "user") {
			// Handle user messages - content might be string or complex object
			let contentText = "Unknown content";
			if (typeof message.content === "string") {
				contentText = message.content;
			} else if (message.content && typeof message.content === "object") {
				try {
					contentText = JSON.stringify(message.content).substring(
						0,
						TRUNCATE_LENGTH,
					);
				} catch (e) {
					contentText = "Complex content";
				}
			}

			const truncatedContent =
				contentText.length > TRUNCATE_LENGTH
					? contentText.substring(0, TRUNCATE_LENGTH) + "..."
					: contentText;

			parts.push(`👤 **User request**: ${truncatedContent}`);
		} else if (message.role === "assistant") {
			// Assistant messages - could be string, array of content parts, or have tool_calls
			if (typeof message.content === "string") {
				const truncatedContent =
					message.content.length > TRUNCATE_LENGTH
						? message.content.substring(0, TRUNCATE_LENGTH) + "..."
						: message.content;
				parts.push(`🧠 **AI thinking**: ${truncatedContent}`);
			} else if (Array.isArray(message.content)) {
				// Also include text content if present
				const textItems = message.content
					.map((item) =>
						item && item.type === "text" && typeof item.text === "string"
							? item.text
							: undefined,
					)
					.filter((x) => x !== undefined);

				if (textItems.length > 0) {
					// Just take the first text for brevity
					const firstText = textItems[0];
					const truncatedText =
						firstText.length > TRUNCATE_LENGTH
							? firstText.substring(0, TRUNCATE_LENGTH) + "..."
							: firstText;
					parts.push(`💭 **AI thinking**: ${truncatedText}`);
				}
			}
		} else if (message.role === "tool") {
			const toolName = message.content.map((x) => x.toolName).join(", ");
			parts.push(`🔄 **Tool response**: ${toolName}`);
		}
	}

	return parts.join("\n\n");
}