# AI Agent for RivetKit

Example project demonstrating AI-powered chat with tools and persistent conversation history using [RivetKit](https://rivetkit.org).

[Learn More →](https://github.com/rivet-gg/rivetkit)

[Discord](https://rivet.gg/discord) — [Documentation](https://rivetkit.org) — [Issues](https://github.com/rivet-gg/rivetkit/issues)

## Getting Started

### Prerequisites

- Node.js 18+
- OpenAI API key ([Get one here](https://platform.openai.com/api-keys))

### Installation

```sh
git clone https://github.com/rivet-gg/rivetkit
cd rivetkit/examples/ai-agent
npm install
```

### Configuration

Create a `.env` file in the project root:
```env
OPENAI_API_KEY=sk-your-api-key-here
```

### Development

Start both frontend and backend servers:

```sh
npm run dev
```

Open your browser to `http://localhost:5173` to use the AI chat interface.

## Features

- AI-powered chat using OpenAI's GPT-4 mini
- Real-time messaging with WebSocket support
- Persistent conversation history with Rivet Actors
- Built-in weather tool example

## License

Apache 2.0