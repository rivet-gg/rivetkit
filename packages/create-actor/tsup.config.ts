import { defineConfig } from "tsup";
import Macros from "unplugin-macros/esbuild";

export default defineConfig({
	entry: ["src/index.ts"],
	target: "esnext",
	format: "esm",
	esbuildPlugins: [
		// @ts-ignore
		Macros(),
	],
});
