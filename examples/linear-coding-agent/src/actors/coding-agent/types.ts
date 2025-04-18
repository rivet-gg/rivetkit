/**
 * Types used by the coding agent
 */

// Linear Types
export type IssueStatus = 'In Progress' | 'In Review' | 'Done' | 'Canceled' | string;

// GitHub Types
export interface GitHubFile {
  path: string;
  type: 'file' | 'directory';
  sha?: string;
}

export interface GitHubFileContent {
  content: string;
  sha: string;
  path: string;
}

export interface PullRequestInfo {
  id: number;
  number: number;
  url: string;
  noDiff?: boolean;
}

// LLM Types are now imported from the AI SDK in llm.ts

export interface LLMToolResult {
  success: boolean;
  result: any;
  error?: string;
}

// Request types for queue
export type RequestType = 'issueCreated' | 'commentCreated' | 'issueUpdated';

export interface QueuedRequest {
  id: string; // Unique ID for the request
  type: RequestType;
  timestamp: number;
  data: LinearWebhookEvent; // The LinearWebhookEvent for the request
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
}

// Actor Types
export interface CodingAgentState {
  // Linear issue information
  linear: {
    issueId: string;
    status: IssueStatus;
    llmProgressCommentId?: string | null; // ID of the comment used for tracking LLM progress
  };
  
  // GitHub repository information
  github: {
    owner: string;
    repo: string;
    baseBranch: string;
    branchName: string;
    prInfo: PullRequestInfo | null;
  };
  
  // Source code state
  code: {
    fileTree: GitHubFile[];
    modifiedFiles: Record<string, string>; // path -> contents
  };
  
  // LLM conversation history
  llm: {
    history: LLMMessage[]; // Type is defined in llm.ts as CoreSystemMessage | CoreUserMessage | CoreAssistantMessage | CoreToolMessage
  };

  // Request queue
  queue: {
    requests: QueuedRequest[];
    isProcessing: boolean;
    lastProcessed: number; // Timestamp of the last processed request
  };
  
  // Debug information
  debug: {
    currentOperation: string; // What the agent is currently working on
    lastUpdated: number; // Timestamp of the last update
    stage: string; // Current processing stage (e.g., "fetching files", "generating code", etc.)
    requestId?: string; // Current request being processed
  };
}

export interface CodingAgentVars {
  // Store the current abort controller for LLM requests
  llmAbortController?: AbortController;
  
  // Queue processing promise
  queueProcessingPromise?: Promise<void>;
}

// Re-export LinearWebhookEvent for convenience
import { LinearWebhookEvent } from '../../types';
import { LLMMessage } from './llm';
export type { LinearWebhookEvent };
