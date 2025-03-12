# Actor Core React

🎭 React integration for [ActorCore](https://actorcore.org/introduction)


## Installation

1. First install the package:

```bash
# npm
npm add @actor-core/react

# pnpm
pnpm add @actor-core/react

# Yarn
yarn add @actor-core/react

# Bun
bun add @actor-core/react
```

## Quick Start

```tsx
import {
	useActor,
	useActorEvent,
	ActorCoreClientProvider,
} from "@actor-core/react";
import { Client } from "actor-core/client";
import type CounterActor from "../actors/my-counter-actor";

// Create a client
const client = new Client("http://your-actor-core-server.com");

function App() {
	return (
		// Provide the client to your App
		<ActorCoreClientProvider client={client}>
			<Counter />
			<Logs />
		</ActorCoreClientProvider>
	);
}

function Counter() {
	// Get or create an actor
	const [{ actor }] = useActor<CounterActor>({ name: "counter" });

	return (
		<div>
			<p>Current: {actor?.state.count}</p>
			<button
				type="button"
				onClick={() => actor?.increment()}
				disabled={!actor}
			>
				Increment
			</button>
		</div>
	);
}

function Logs() {
	// Get or create an actor
	const [{ actor }] = useActor<CounterActor>({ name: "counter" });

	// Listen to events
	useActorEvent({actor, event: "newCount"}, (...args) => {
		console.log("Received new count event", args);
	});

	return null;
}

render(<App />, document.getElementById("root"));
```
