# RivetKit React

🎭 React integration for [RivetKit](https://rivetkit.org/introduction)


## Installation

1. First install the package:

```bash
# npm
npm add rivetkit/react

# pnpm
pnpm add rivetkit/react

# Yarn
yarn add rivetkit/react

# Bun
bun add rivetkit/react
```

## Quick Start

```tsx
import { createClient } from "rivetkit/client";
import { createReactActorCore } from "@rivetkit/react";
import type { Registry } from "../counter/src/index";
import React, { useState } from "react";

// Create a client
const client = createClient<Registry>("http://your-rivetkit-server.com");

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
