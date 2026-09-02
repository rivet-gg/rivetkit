import browserbase from "@agentos-software/browserbase";
import { agentOS, setup } from "@rivet-dev/agentos";

// `browse` is exposed inside the VM as a command on `$PATH`.
const vm = agentOS({
	software: [browserbase],
});

export const registry = setup({ use: { vm } });
registry.start();
