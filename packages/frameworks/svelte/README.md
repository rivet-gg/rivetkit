# RivetKit Svelte

_Lightweight Libraries for Backends_

Svelte 5 integration for RivetKit with full runes support.

[Learn More →](https://github.com/rivet-gg/rivetkit)

[Discord](https://rivet.gg/discord) — [Documentation](https://rivetkit.org) — [Issues](https://github.com/rivet-gg/rivetkit/issues)

## Installation

```bash
pnpm add @rivetkit/svelte @rivetkit/core
```

## Quick Start

```typescript
// lib/rivetkit.ts
import { createClient, createRivetKit } from "@rivetkit/svelte";
import type { Registry } from "./actors/registry";

const client = createClient<Registry>("http://localhost:8080");
export const { useActor } = createRivetKit(client);
```

```svelte
<!-- App.svelte -->
<script lang="ts">
  import { useActor } from "./lib/rivetkit";

  const actor = useActor({
    name: "counter",
    key: ["my-counter"],
    enabled: true
  });

  // Listen for events
  actor.useEvent("increment", (data) => {
    console.log("Counter incremented:", data);
  });

  async function increment() {
    if (actor.handle) {
      await actor.handle.increment();
    }
  }
</script>

<div>
  <h1>Counter: {actor.state?.count ?? 0}</h1>
  
  {#if actor.isConnecting}
    <p>Connecting...</p>
  {:else if actor.isError}
    <p>Error: {actor.error?.message}</p>
  {:else if actor.isConnected}
    <button onclick={increment}>Increment</button>
  {/if}
</div>
```

## Features

- **Svelte 5 Runes**: Full support for Svelte 5's new reactivity system
- **Type Safety**: Complete TypeScript support with actor type inference
- **Automatic Cleanup**: Handles connection lifecycle automatically
- **Event Handling**: Built-in event listener management
- **Reactive State**: All actor state is automatically reactive

## API Reference

### `createRivetKit(client, options?)`

Creates the RivetKit functions for Svelte integration.

#### Parameters

- `client`: The RivetKit client created with `createClient`
- `options`: Optional configuration object

#### Returns

An object containing:
- `useActor`: Function for connecting to actors

### `useActor(options)`

Function that connects to an actor and manages the connection lifecycle with Svelte 5 runes.

#### Parameters

- `name`: Actor name (type-safe)
- `key`: Unique key for the actor instance
- `params`: Optional parameters for the actor
- `enabled`: Whether the actor is enabled (defaults to true)

#### Returns

An object with reactive properties:
- `isConnected`: Whether the actor is connected
- `isConnecting`: Whether the actor is currently connecting
- `isError`: Whether there was an error
- `error`: The error object (if any)
- `connection`: The actor connection
- `handle`: The actor handle for calling actions
- `state`: The current actor state
- `useEvent`: Function to listen for actor events

## License

Apache 2.0
