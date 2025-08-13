<script lang="ts">
  import { onMount } from "svelte";
  import { useActor } from "../lib/actor-client";

  let count = $state(0);
  const counter = useActor({ name: 'counter', key: ['test-counter'] });

	$effect(()=>{
		 console.log('status', counter?.isConnected);
		 counter?.useEvent('newCount', (x: number) => {
	      console.log('new count event', x);
	      count=x;
	    });
			//also works
			// counter.connection?.on('newCount', (x: number) => {
	  		//     console.log('new count event', x);
			//     count=x;
			//   })
	})
  const increment = () => {
      counter?.connection?.increment(1);

  };
  const reset = () => {
      counter?.connection?.reset();

  };

  // $inspect is for debugging, but ensure it's used correctly
  $inspect('useActor is connected', counter?.isConnected);
</script>

<div>
  <h1>Counter: {count}</h1>
  <button onclick={increment}>Increment</button>
  <button onclick={reset}>Reset</button>
</div>
