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
import { createClient } from "actor-core/client";
import { createReactActorCore } from "@actor-core/react";
import type { App } from "../counter/src/index";
import React, { useState } from "react";

// Create a client
const client = createClient<App>("http://your-actor-core-server.com");

// Create React hooks for your actors
const { useActor, useActorEvent } = createReactActorCore(client);

function ReactApp() {
	return (
		<>
			<Counter />
		</>
	);
}

function Counter() {
	// Get or create an actor
	const [{ actor }] = useActor("counter");

	return (
		<div>
			<CounterValue actor={actor} />
			<button
				type="button"
				onClick={() => actor?.increment(1)}
				disabled={!actor}
			>
				Increment
			</button>
		</div>
	);
}

function CounterValue({ actor }) {
	const [count, setCount] = useState(0);

	// Listen to events
	useActorEvent({ actor, event: "newCount" }, (newCount) => {
		setCount(newCount);
	});

	return count;
}

render(<ReactApp />, document.getElementById("root"));
```
