<p align="center">
  <a href="https://actorcore.org">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="./.github/media/icon-text-white.svg" alt="ActorCore" width="400">
      <img src="./.github/media/icon-text-white.svg" alt="ActorCore" width="400">
    </picture>
  </a>
</p>

<h3 align="center">Stateful, Scalable, Realtime Backend Framework</h3>
<h4 align="center">
</h4>
<p align="center">
  <!-- <a href="https://github.com/rivet-gg/rivet/graphs/commit-activity"><img alt="GitHub commit activity" src="https://img.shields.io/github/commit-activity/m/rivet-gg/rivet?style=flat-square"/></a> -->
  <a href="https://github.com/orgs/rivet-gg/discussions"><img alt="GitHub Discussions" src="https://img.shields.io/github/discussions/rivet-gg/rivet?logo=github&logoColor=fff"></a>
    <a href="https://rivet.gg/discord"><img alt="Discord" src="https://img.shields.io/discord/822914074136018994?color=7389D8&label&logo=discord&logoColor=ffffff"/></a>
   <a href="https://twitter.com/rivet_gg"><img src="https://img.shields.io/twitter/follow/rivet_gg" alt="Rivet Twitter" /></a>
   <a href="https://bsky.app/profile/rivet.gg"><img src="https://img.shields.io/badge/Follow%20%40rivet.gg-4C1?color=0285FF&logo=bluesky&logoColor=ffffff" alt="Rivet Bluesky" /></a>
  <a href="/LICENSE"><img alt="License Apache-2.0" src="https://img.shields.io/github/license/rivet-gg/rivet?logo=open-source-initiative&logoColor=white"></a>
</p>

## Intro

The modern way to build multiplayer, realtime, or AI agent backends.

Supports [Rivet](https://actorcore.org/platforms/rivet), [Cloudflare Workers](https://actorcore.org/platforms/cloudflare-workers), [Bun](https://actorcore.org/platforms/bun), and [Node.js](https://actorcore.org/platforms/nodejs).

### Architecture

- 💾 **Durable, In-Memory State**: Fast in-memory access with built-in durability — no external databases or caches needed.
- ⚡ **Ultra-Fast State Updates**: Real-time state updates with ultra-low latency, powered by co-locating compute and data.
- 🔋 **Batteries Included**: Integrated support for state, RPC, events, scheduling, and multiplayer — no extra boilerplate code needed.
- 🖥️ **Serverless & Scalable**: Effortless scaling, scale-to-zero, and easy deployments on any serverless runtime.

### Features

- 💾 [**State**](https://actorcore.org/concepts/state): Fast in-memory access with built-in durability.
- 💻 [**RPC**](https://actorcore.org/concepts/rpc): Remote procedure calls for seamless client-server communication.
- 📡 [**Events**](https://actorcore.org/concepts/events): Real-time event handling and broadcasting.
- ⏰ [**Scheduling**](https://actorcore.org/concepts/schedule): Timed tasks and operations management.
- 🌐 [**Connections & Multiplayer**](https://actorcore.org/concepts/connections): Manage connections and multiplayer interactions.
- 🏷️ [**Metadata**](https://actorcore.org/concepts/metadata): Store and manage additional data attributes.

### What makes ActorCore different?

ActorCore is the modern way to build realtime, stateful backends.

| Feature         | ActorCore | Durable Objects | AWS Lambda | Redis | Socket.io |
| --------------- | --------- | --------------- | ---------- | ----- | --------- |
| In-Memory State | ✓         | ✓               |            | ✓     | ✓         |
| Durable State   | ✓         | ✓               |            |       |           |
| RPC             | ✓         | ✓               | ✓          |       | ✓         |
| Events          | ✓         |                 |            |       | ✓         |
| Scheduling      | ✓         |                 |            |       |           |
| Edge Computing  | ✓ †       | ✓               | ✓          |       |           |
| No Vendor Lock  | ✓         |                 |            | ✓     | ✓         |

† = on supported platforms

## Getting Started

### Step 1: Installation

```bash npm
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
  console.log(`Message from ${username}: ${message}`)
);

// send message to room
await chatRoom.sendMessage("william", "All the world's a stage.");
```

### Step 4: Deploy

Deploy to your platform of choice:

- [**Rivet**](https://actorcore.org/platforms/rivet)
- [**Cloudflare Workers**](https://actorcore.org/platforms/cloudflare-workers)
- [**Bun**](https://actorcore.org/platforms/bun)
- [**Node.js**](https://actorcore.org/platforms/nodejs)

## Community & Support

- Join our [**Discord**](https://rivet.gg/discord)
- Follow us on [**X**](https://x.com/rivet_gg)
- Follow us on [**Bluesky**](https://bsky.app/profile/rivet-gg.bsky.social)
- File bug reports in [**GitHub Issues**](https://github.com/rivet-gg/ActorCore/issues)
- Post questions & ideas in [**GitHub Discussions**](https://github.com/orgs/rivet-gg/discussions)

## License

Apache 2.0
