# Linear Coding Agent for RivetKit

Example project demonstrating AI-powered coding agent with Linear and GitHub integration with [RivetKit](https://rivetkit.org).

[Learn More →](https://github.com/rivet-gg/rivetkit)

[Discord](https://rivet.gg/discord) — [Documentation](https://rivetkit.org) — [Issues](https://github.com/rivet-gg/rivetkit/issues)

## Getting Started

### Prerequisites

- Node.js
- GitHub repository access
- Linear workspace
- Anthropic API key (for Claude)

### Installation

```sh
git clone https://github.com/rivet-gg/rivetkit
cd rivetkit/examples/linear-coding-agent
npm install
```

### Development

```sh
npm run dev
```

Configure your environment variables for GitHub, Linear, and Anthropic API keys. The agent will automatically handle Linear webhooks and create GitHub PRs based on Linear issues.

## License

Apache 2.0