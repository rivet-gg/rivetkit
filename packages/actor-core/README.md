# ActorCore

_The Stateful Serverless Framework_

Build AI agents, realtime apps, game servers, and more.

Supports Rivet, Cloudflare Workers, Bun, and Node.js.

## Resources

- [Quickstart](https://actorcore.org/introduction)
- [Documentation](https://actorcore.org/)
- [Examples](https://github.com/rivet-gg/actor-core/tree/main/examples)

## Getting Started

### Step 1: Installation

```bash
# npm
npm add actor-core

# pnpm
pnpm add actor-core

# Yarn
yarn add actor-core

# Bun
bun add actor-core
```

### Step 2: Create an Actor

```typescript
import { Actor, type Rpc } from "actor-core";

export interface State {
    messages: { username: string; message: string }[];
}

export default class ChatRoom extends Actor<State> {
    // initialize this._state
    _onInitialize() {
        return { messages: [] };
    }

    // receive an remote procedure call from the client
    sendMessage(rpc: Rpc<ChatRoom>, username: string, message: string) {
        // save message to persistent storage
        this._state.messages.push({ username, message });

        // broadcast message to all clients
        this._broadcast("newMessage", username, message);
    }
}
```

### Step 3: Connect to Actor

```typescript
import { Client } from "actor-core/client";
import type ChatRoom from "../src/chat-room.ts";

const client = new Client(/* manager endpoint */);

// connect to chat room
const chatRoom = await client.get<ChatRoom>({ name: "chat" });

// listen for new messages
chatRoom.on("newMessage", (username: string, message: string) =>
    console.log(`Message from ${username}: ${message}`),
);

// send message to room
await chatRoom.sendMessage("william", "All the world's a stage.");
```

### Step 4: Deploy

Deploy to your platform of choice:

- [Cloudflare Workers](https://actorcore.org/platforms/cloudflare-workers)
- [Rivet](https://actorcore.org/platforms/rivet)

## Community & Support

- Join our [Discord](https://rivet.gg/discord)
- Follow us on [X](https://x.com/rivet_gg)
- Follow us on [Bluesky](https://bsky.app/profile/rivet-gg.bsky.social)
- File bug reports in [GitHub Issues](https://github.com/rivet-gg/actor-core/issues)
- Post questions & ideas in [GitHub Discussions](https://github.com/orgs/rivet-gg/discussions)

## License

Apache 2.0

