import { defineConfig } from "tsup";
import Macros from "unplugin-macros/esbuild";

export default defineConfig({
	entry: ["src/cli.ts"],
	platform: "node",
	bundle: true,
	format: "esm",
	clean: true,
	minify: true,
	shims: true,
	dts: false,
	sourcemap: true,
	esbuildPlugins: [
		// @ts-ignore
		Macros(),
	],
	banner(ctx) {
		return { js: "#!/usr/bin/env node" };
	},
});
