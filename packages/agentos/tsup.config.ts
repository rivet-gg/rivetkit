import { defineConfig } from "tsup";

export default defineConfig({
	format: ["esm"],
	dts: true,
	sourcemap: true,
	clean: true,
	external: ["@rivet-dev/agentos-core"],
});
