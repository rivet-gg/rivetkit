import { defineConfig } from "tsup";
import defaultConfig from "../../tsup.base.ts";

export default defineConfig({
	...defaultConfig,
	noExternal: ["@rivetkit/engine-runner", "@rivetkit/engine-runner-protocol"],
});
