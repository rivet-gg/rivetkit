# RivetKit React

🎭 React integration for [RivetKit](https://rivetkit.org/)

> [!NOTE]
> Looking for the integration with your favorite framework? Let us know by creating an issue on GitHub, or on [Discord](https://rivet.gg/discord).
> If you want to contribute, check out the [contribution guide](../../../CONTRIBUTING.md).


## Installation

1. First install the package:

```bash
# npm
npm add @rivetkit/react

# pnpm
pnpm add @rivetkit/react

# Yarn
yarn add @rivetkit/react

# Bun
bun add @rivetkit/react
```

## Quick Start

```tsx
import { createClient, createRivetKit } from "@rivetkit/react";
import type { Registry } from "../counter/src/index";
import React, { useState } from "react";

// Create a client
const client = createClient<Registry>("http://your-rivetkit-server.com");

// Create React hooks for your workers
const { useWorker } = createRivetKit(client);

function ReactApp() {
	return (
		<>
			<Counter />
		</>
	);
}

function Counter() {
	// Get or create a Worker
	// This will create a new worker if it doesn't exist
	// using the hook with the same parameters will return the same worker without creating a new one
	const worker = useWorker({
		name: "counter",
	});

	return (
		<div>
			<CounterValue worker={worker} />
			<button
				type="button"
				onClick={() => worker?.connection?.increment(1)}
				disabled={!worker}
			>
				Increment
			</button>
		</div>
	);
}

function CounterValue({ worker }) {
	const [count, setCount] = useState(0);

	// Listen to events
	worker.useEvent("newCount", (newCount) => {
		setCount(newCount);
	});

	return count;
}

render(<ReactApp />, document.getElementById("root"));
```
