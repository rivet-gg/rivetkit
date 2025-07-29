# Mastra AI Agent for RivetKit

Example project demonstrating AI agent integration with Mastra and [RivetKit](https://rivetkit.org).

[Learn More →](https://github.com/rivet-gg/rivetkit)

[Discord](https://rivet.gg/discord) — [Documentation](https://rivetkit.org) — [Issues](https://github.com/rivet-gg/rivetkit/issues)

## Getting Started

### Prerequisites

- Node.js 18+
- OpenAI API key

### Installation

```sh
git clone https://github.com/rivet-gg/rivetkit
cd rivetkit/examples/mastra
npm install
```

### Development

1. Set your OpenAI API key:
```sh
export OPENAI_API_KEY=your-api-key-here
```

2. Start the development server:
```sh
npm run dev
```

3. Open your browser to `http://localhost:8080`

## Features

- **Persistent AI conversations** that survive server restarts
- **Real-time weather data** using Open-Meteo API
- **Memory system** for saving and recalling information
- **Per-user state isolation** with automatic persistence
- **Web interface** for testing and interaction
- **RESTful API** endpoints for programmatic access

## API Reference

### Chat Endpoint
```
POST /chat
Body: { "userId": string, "message": string }
Response: { "response": string, "messageId": string, "timestamp": number }
```

### History Endpoint
```
GET /chat/:userId/history
Response: { "history": Message[], "total": number, "actorName": string }
```

### Clear Endpoint
```
DELETE /chat/:userId
Response: { "success": boolean, "message": string }
```

## How It Works

The integration combines Rivet Actors for state persistence with Mastra agents for AI processing:

1. **Rivet Actors** store conversation history, user memory, and tool data
2. **Mastra Agents** process messages using OpenAI with access to tools
3. **Tools** can call external APIs (weather) and modify persistent state
4. **State automatically persists** across server restarts and user sessions

Each user gets their own isolated actor instance that maintains state between interactions.

## Architecture

```
┌─────────────────────────────────┐
│          Rivet Actor            │
│  ┌───────────────────────────┐  │
│  │      Mastra Agent         │  │
│  │   • OpenAI GPT-4o-mini    │  │
│  │   • Weather Tool          │  │
│  │   • Memory Tool           │  │
│  │   • Recall Tool           │  │
│  └───────────────────────────┘  │
│                                 │
│  Persistent State:              │
│  • messages[]                   │
│  • userMemory{}                 │
│  • toolData{}                   │
└─────────────────────────────────┘
```

## Example Interactions

**Weather Query:**
```
User: "What's the weather in Tokyo?"
AI: "The current weather in Tokyo is clear sky with a temperature of 18°C, feels like 16°C, humidity at 65%, and wind speed of 12 km/h."
```

**Memory System:**
```
User: "Remember my favorite color is blue"
AI: "I've remembered: my favorite color is blue"

User: "What do you remember about me?"
AI: "Here's what I remember:
- You told me: my favorite color is blue
- Last weather: Tokyo - Clear sky, 18°C"
```

## License

Apache 2.0