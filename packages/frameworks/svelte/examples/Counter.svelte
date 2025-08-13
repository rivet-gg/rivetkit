<script lang="ts">
  import {createClient, createRivetKit } from "../src/mod.svelte";


  // Example registry type - in real usage this would be imported
  interface CounterActor {
    state: { count: number };
    actions: {
      increment(): Promise<void>;
      decrement(): Promise<void>;
      reset(): Promise<void>;
    };
    events: {
      incremented: { count: number };
      decremented: { count: number };
      reset: { count: number };
    };
  }

  interface Registry {
    counter: CounterActor;
  }

  // Create client and RivetKit instance
  const client = createClient<Registry>("http://localhost:8080");
  const { useActor } = createRivetKit(client);

  // Connect to the counter actor
  const { actorState, useEvent } = useActor({
    name: "counter",
    key: ["demo-counter"],
    enabled: true
  });

  // Listen for events
  useEvent("incremented", (data) => {
    console.log("Counter incremented to:", data.count);
  });

  useEvent("decremented", (data) => {
    console.log("Counter decremented to:", data.count);
  });

  useEvent("reset", (data) => {
    console.log("Counter reset to:", data.count);
  });

  // Action actorStaters
  async function increment() {
      await actorState?.increment();
  }

  async function decrement() {
      await actorState?.decrement();
  }

  async function reset() {
      await actorState?.reset();
  }
</script>

<div class="counter-container">
  <h1>RivetKit Svelte Counter</h1>

  <div class="status">
    {#if actorState.isConnecting}
      <p class="status-connecting">🔄 Connecting to actor...</p>
    {:else if actorState.isError}
    <p class="status-error">❌ Error: {actorState.error?.message}</p>
    {:else if actorState.isConnected}
      <p class="status-connected">✅ Connected to actor</p>
    {:else}
      <p class="status-disconnected">⚪ Disconnected</p>
    {/if}
  </div>

  <div class="counter-display">
    <h2>Count: {actorState.state?.count ?? 0}</h2>
  </div>

  <div class="controls">
    <button
      onclick={decrement}
      disabled={!actorState.isConnected}
      class="btn btn-decrement"
    >
      -1
    </button>

    <button
      onclick={reset}
      disabled={!actorState.isConnected}
      class="btn btn-reset"
    >
      Reset
    </button>

    <button
      onclick={increment}
      disabled={!actorState.isConnected}
      class="btn btn-increment"
    >
      +1
    </button>
  </div>
</div>

<style>
  .counter-container {
    max-width: 400px;
    margin: 2rem auto;
    padding: 2rem;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    font-family: system-ui, sans-serif;
  }

  h1 {
    text-align: center;
    color: #1a202c;
    margin-bottom: 1.5rem;
  }

  .status {
    margin-bottom: 1.5rem;
    text-align: center;
  }

  .status p {
    margin: 0;
    padding: 0.5rem;
    border-radius: 4px;
    font-weight: 500;
  }

  .status-connecting {
    background-color: #fef3c7;
    color: #92400e;
  }

  .status-error {
    background-color: #fee2e2;
    color: #dc2626;
  }

  .status-connected {
    background-color: #d1fae5;
    color: #065f46;
  }

  .status-disconnected {
    background-color: #f3f4f6;
    color: #6b7280;
  }

  .counter-display {
    text-align: center;
    margin: 2rem 0;
  }

  .counter-display h2 {
    font-size: 2.5rem;
    color: #1a202c;
    margin: 0;
  }

  .controls {
    display: flex;
    gap: 1rem;
    justify-content: center;
  }

  .btn {
    padding: 0.75rem 1.5rem;
    border: none;
    border-radius: 6px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-decrement {
    background-color: #ef4444;
    color: white;
  }

  .btn-decrement:hover:not(:disabled) {
    background-color: #dc2626;
  }

  .btn-reset {
    background-color: #6b7280;
    color: white;
  }

  .btn-reset:hover:not(:disabled) {
    background-color: #4b5563;
  }

  .btn-increment {
    background-color: #10b981;
    color: white;
  }

  .btn-increment:hover:not(:disabled) {
    background-color: #059669;
  }
</style>
