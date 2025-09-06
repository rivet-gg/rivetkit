# RivetKit Svelte

A Svelte 5 integration for [RivetKit](https://rivetkit.com) that provides reactive actor connections using Svelte's new runes system.

## Installation

```sh
pnpm add @rivetkit/svelte

# or

npm i @rivetkit/svelte
```

## Overview

RivetKit Svelte provides seamless integration between RivetKit's actor system and Svelte 5's reactive runes. It allows you to connect to RivetKit actors from your Svelte components with automatic reactivity, real-time event handling, and type safety.

## Features

- **Svelte 5 Runes Integration** - Built specifically for Svelte 5's new reactivity system
- **Real-time Actor Connections** - Connect to RivetKit actors with automatic state synchronization
- **Event Handling** - Listen to actor events with automatic cleanup
- **Type Safety** - Full TypeScript support with proper type inference
- **SSR Compatible** - Works with SvelteKit's server-side rendering
- **Automatic Reconnection** - Handles connection states and errors gracefully

## Quick Start

### Step 1: Set Up Your RivetKit Backend

First, create your RivetKit actors and registry. Here's a simple counter example:

```typescript
// backend/registry.ts
import { actor, setup } from "@rivetkit/actor";

export const counter = actor({
  onAuth: () => {
    // Configure auth here if needed
  },
  state: { count: 0 },
  actions: {
    increment: (c, x: number) => {
      console.log("incrementing by", x);
      c.state.count += x;
      c.broadcast("newCount", c.state.count);
      return c.state.count;
    },
    reset: (c) => {
      c.state.count = 0;
      c.broadcast("newCount", c.state.count);
      return c.state.count;
    },
  },
});

export const registry = setup({
  use: { counter },
});
```

### Step 2: Start Your RivetKit Server

```typescript
// backend/index.ts
import { registry } from "./registry";

export type Registry = typeof registry;

registry.runServer({
  cors: {
    origin: "http://localhost:5173", // Your Svelte app URL
  },
});
```

### Step 3: Create the Client Connection

In your Svelte app, create a client connection to your RivetKit server:

```typescript
// src/lib/actor-client.ts
import { createClient, createRivetKit } from "@rivetkit/svelte";
import type { Registry } from "../../backend";

const client = createClient<Registry>(`http://localhost:8080`);
export const { useActor } = createRivetKit(client);
```

### Step 4: Use Actors in Your Svelte Components

Now you can use the `useActor` function in your Svelte 5 components:

```svelte
<!-- src/routes/+page.svelte -->
<script lang="ts">
  import { useActor } from "../lib/actor-client";

  let count = $state(0);
  const counter = useActor({ name: 'counter', key: ['test-counter'] });

  $effect(() => {
    console.log('status', counter?.isConnected);
    counter?.useEvent('newCount', (x: number) => {
      console.log('new count event', x);
      count = x;
    });
  });

  const increment = () => {
    counter?.connection?.increment(1);
  };

  const reset = () => {
    counter?.connection?.reset();
  };

  // Debug the connection status
  $inspect('useActor is connected', counter?.isConnected);
</script>

<div>
  <h1>Counter: {count}</h1>
  <button onclick={increment}>Increment</button>
  <button onclick={reset}>Reset</button>
</div>
```

## Core Concepts

### useActor Hook

The `useActor` function is the main way to connect to RivetKit actors from your Svelte components. It returns a reactive object with the following properties:

- **`connection`** - The actor connection object for calling actions
- **`handle`** - The actor handle for advanced operations
- **`isConnected`** - Boolean indicating if the actor is connected
- **`isConnecting`** - Boolean indicating if the actor is currently connecting
- **`isError`** - Boolean indicating if there's an error
- **`error`** - The error object if one exists
- **`useEvent`** - Function to listen for actor events

### Actor Options

When calling `useActor`, you need to provide:

```typescript
const actor = useActor({
  name: 'counter',           // The actor name from your registry
  key: ['test-counter'],     // Unique key for this actor instance
  params: { /* ... */ },     // Optional parameters
  enabled: true              // Optional, defaults to true
});
```

## Event Handling

### Using useEvent

The `useEvent` function allows you to listen for events broadcast by actors:

```svelte
<script lang="ts">
  import { useActor } from "../lib/actor-client";

  const chatActor = useActor({ name: 'chat', key: ['room-1'] });

  $effect(() => {
    // Listen for new messages
    chatActor?.useEvent('newMessage', (message) => {
      console.log('New message:', message);
      // Update your component state
    });

    // Listen for user joined events
    chatActor?.useEvent('userJoined', (user) => {
      console.log('User joined:', user);
    });
  });
</script>
```

### Alternative Event Listening

You can also listen to events directly on the connection:

```svelte
<script lang="ts">
  const actor = useActor({ name: 'counter', key: ['test'] });

  $effect(() => {
    const unsubscribe = actor.connection?.on('newCount', (count) => {
      console.log('Count updated:', count);
    });

    // Cleanup is handled automatically by $effect
    return unsubscribe;
  });
</script>
```

## Advanced Usage

### Conditional Actor Connections

You can conditionally enable/disable actor connections:

```svelte
<script lang="ts">
  let userId = $state<string | null>(null);

  const userActor = useActor({
    name: 'user',
    key: [userId || 'anonymous'],
    enabled: userId !== null
  });
</script>
```

### Multiple Actor Instances

You can connect to multiple instances of the same actor:

```svelte
<script lang="ts">
  const chatRoom1 = useActor({ name: 'chat', key: ['room-1'] });
  const chatRoom2 = useActor({ name: 'chat', key: ['room-2'] });
  const privateChat = useActor({ name: 'chat', key: ['private', userId] });
</script>
```

### Error Handling

Handle connection errors gracefully:

```svelte
<script lang="ts">
  const actor = useActor({ name: 'counter', key: ['test'] });

  $effect(() => {
    if (actor?.isError && actor?.error) {
      console.error('Actor connection error:', actor.error);
      // Show error message to user
    }
  });
</script>

{#if actor?.isError}
  <div class="error">
    Connection failed: {actor.error?.message}
  </div>
{:else if actor?.isConnecting}
  <div class="loading">Connecting...</div>
{:else if actor?.isConnected}
  <div class="success">Connected!</div>
{/if}
```

## API Reference

### createClient(url: string)

Creates a client connection to your RivetKit server.

```typescript
import { createClient } from "@rivetkit/svelte";

const client = createClient<Registry>("http://localhost:8080");
```

### createRivetKit(client: Client)

Creates the RivetKit integration with your client.

```typescript
import { createRivetKit } from "@rivetkit/svelte";

const { useActor } = createRivetKit(client);
```

### useActor(options: ActorOptions)

Connects to a RivetKit actor and returns reactive state.

**Parameters:**
- `name: string` - The actor name from your registry
- `key: string | string[]` - Unique identifier for the actor instance
- `params?: Record<string, string>` - Optional parameters to pass to the actor
- `enabled?: boolean` - Whether the connection is enabled (default: true)

**Returns:**
- `connection` - Actor connection for calling actions
- `handle` - Actor handle for advanced operations
- `isConnected` - Connection status
- `isConnecting` - Loading state
- `isError` - Error state
- `error` - Error object
- `useEvent` - Function to listen for events

## TypeScript Support

RivetKit Svelte provides full TypeScript support. Make sure to type your registry:

```typescript
// backend/index.ts
export type Registry = typeof registry;

// frontend/actor-client.ts
import type { Registry } from "../../backend";
const client = createClient<Registry>("http://localhost:8080");
```

## SvelteKit Integration

RivetKit Svelte works seamlessly with SvelteKit. The library automatically detects browser environment and handles SSR appropriately.

```svelte
<!-- +layout.svelte -->
<script lang="ts">
  import { useActor } from "$lib/actor-client";

  // This will only connect in the browser
  const globalActor = useActor({ name: 'global', key: ['app'] });
</script>
```

## Examples

Check out the `examples` folder in this repository for a complete working example with:
- Backend RivetKit server setup
- Frontend Svelte integration
- Real-time counter with events
- TypeScript configuration

## Contributing

Contributions are welcome! Please read our contributing guidelines and submit pull requests to our repository.

## License

MIT License - see LICENSE file for details.
