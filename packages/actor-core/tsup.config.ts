import { defineConfig } from "tsup";

export default defineConfig({
	target: "es2020",
	format: ["cjs", "esm"],
	sourcemap: true,
	clean: true,
	dts: true,
	minify: false,
	platform: "neutral",
	external: [
		// Optional peer dependencies
		"eventsource",
		"ws",
	],
});
