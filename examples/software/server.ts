import { agentOS, setup } from "@rivet-dev/agentos";
import ripgrep from "@agentos-software/ripgrep";
import jq from "@agentos-software/jq";

// Each entry adds its CLI commands to the VM. Common POSIX utilities ship by
// default; `ripgrep`/`jq` add the `rg` and `jq`
// commands. Browse the registry for more packages.
const vm = agentOS({
	software: [ripgrep, jq],
});

export const registry = setup({ use: { vm } });

registry.start();
