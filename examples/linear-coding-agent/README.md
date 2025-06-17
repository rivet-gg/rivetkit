# Linear AI Agent with GitHub Integration

This project implements an AI agent that automatically manages GitHub code changes based on Linear issues. The agent handles the full development workflow from issue creation to PR merging.

## Features

- **Issue-Driven Development**:
  - When an issue is created in Linear, the agent creates a branch and PR automatically
  - Uses LLM to analyze and implement the required changes
  - Links PRs back to Linear issues

- **Continuous Feedback Loop**:
  - Responds to comments on Linear issues by making additional code changes
  - Updates the PR with the new changes
  - Provides detailed summaries of changes made

- **End-to-End Workflow**:
  - Handles Linear issue status transitions
  - Merges or closes PRs based on issue status changes
  - Maintains consistency between GitHub PRs and Linear issues

## Getting Started

### Prerequisites

- Node.js (v18 or later)
- GitHub repository access
- Linear workspace
- Anthropic API key (for Claude)

### Installation

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Copy the environment variables:
   ```
   cp .env.example .env
   ```
4. Fill in your configuration details in the `.env` file

### Running the Agent

You can run the agent in several ways:

#### Option 1: Running Everything at Once

Using concurrently to run both the actor server and webhook server:

```
npm run start
```

To also expose your local server to the internet via ngrok:

```
npm run start:ngrok
```

The ngrok URL can be used to configure a Linear webhook.

#### Option 2: Running Services Separately

##### Starting the Actor Core Server

This starts the RivetKit server that hosts the coding agent:

```
npm run dev
# Or using the RivetKit CLI
npx rivetkit/cli dev src/workers/registry.ts
```

##### Running the Webhook Server (for Linear integration)

In a separate terminal, run the HTTP server that receives Linear webhooks and forwards them to the agent:

```
npm run server
```

The webhook server will be available at:
- HTTP endpoint for Linear webhooks: `http://localhost:3000/api/webhook/linear`
- Queue status endpoint: `http://localhost:3000/api/queue/:issueId`
- Health check: `http://localhost:3000/health`

The webhook endpoint includes signature verification for added security. When configuring your Linear webhook, make sure to:
1. Copy the webhook secret provided by Linear
2. Add it to your `.env` file as `LINEAR_WEBHOOK_SECRET`

#### Monitoring and Debugging

The agent provides several API endpoints for monitoring and debugging:

##### Queue Status API

Check the status of the request queue for a specific issue:

```bash
# Replace ISSUE-ID with your Linear issue ID
curl http://localhost:8080/api/queue/ISSUE-ID
```

This returns details about the queue including:
- Number of pending, processing, completed, and failed requests
- Whether the queue is currently being processed
- Timestamp of the last processed request

##### Debug Information API

Get detailed debug information about a specific issue:

```bash
# Replace ISSUE-ID with your Linear issue ID
curl http://localhost:8080/api/debug/ISSUE-ID
```

This provides comprehensive debug information including:
- Current operation and processing stage
- Queue status and statistics
- Linear issue details
- GitHub repository and branch information
- Code changes and modifications
- LLM processing status
- Actor metadata

##### LLM Conversation History API

View the complete conversation history with the LLM for a specific issue:

```bash
# Replace ISSUE-ID with your Linear issue ID
curl http://localhost:8080/api/history/ISSUE-ID
```

This returns the full sequence of messages exchanged with the LLM, including:
- System prompts
- User messages
- Assistant responses
- Tool invocations and results

##### Exposing Webhooks to the Internet (for Linear integration)

To expose your local webhook server to the internet:

```
npm run ngrok
```

#### Local Testing

For local testing without actual webhooks, you can use the debugging CLI tools:

```bash
# Check the status of a specific issue
yarn cli status <ISSUE-ID>

# Get debug information for a specific issue
yarn cli debug <ISSUE-ID>

# View conversation history with the LLM
yarn cli history <ISSUE-ID>
```

This allows you to monitor and debug the agent's behavior for specific issues.

### Configuration

Set the following environment variables:

- `GITHUB_TOKEN`: GitHub Personal Access Token
- `REPO_OWNER`: GitHub username or organization
- `REPO_NAME`: Repository name
- `BASE_BRANCH`: Base branch name (defaults to 'main')
- `LINEAR_API_KEY`: Linear API Key
- `ANTHROPIC_API_KEY`: Anthropic API Key

## Architecture

The agent is built using the RivetKit framework and consists of:

- **Coding Agent**: Main actor that handles Linear webhook events
- **GitHub Integration**: API client for branch, PR, and file operations
- **Linear Integration**: API client for issue management
- **LLM Service**: Integration with Anthropic Claude for code generation
- **Request Queue**: Durable, persistent queue for processing Linear events

### Request Queue System

The agent implements a durable queue system to ensure reliable processing of Linear events:

- All incoming requests (issue creation, comments, updates) are added to a persistent queue
- The queue is processed asynchronously, with each request handled in order
- If the agent crashes or restarts, it automatically resumes processing pending requests
- Request status is tracked (pending, processing, completed, failed) and can be monitored via API
- Each request has a unique ID for tracking and correlation

This ensures that even during high load or if the agent experiences issues, no webhook events are lost and all will eventually be processed.

## Workflow

1. **On Issue Creation**:
   - Create a new branch
   - Use LLM to implement changes
   - Create a PR linked to the Linear issue
   - Update issue status to "In Review"

2. **On Issue Comment**:
   - Update existing branch with new changes
   - Push changes to the PR
   - Comment with summary of changes

3. **On Issue Status Change**:
   - If "Done": Merge the PR
   - If "Canceled": Close the PR
   - For other statuses: Maintain consistency

## Development

For local development, use:

```
npm run check-types  # Type checking
npm run test         # Run tests
```

