import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	plugins: [
		dts({
			include: ["src/**/*"],
			exclude: ["**/*.test.*", "**/*.spec.*"],
			insertTypesEntry: true,
			rollupTypes: true,
			strictOutput: true,
			copyDtsFiles: false,
		}),
	],
	build: {
		lib: {
			entry: {
				index: resolve(__dirname, "src/index.ts"),
				"rivet.svelte": resolve(__dirname, "src/rivet.svelte.ts"),
			},
			formats: ["cjs", "es"],
		},
		rollupOptions: {
			external: [
				"svelte",
				"svelte/store",
				"@rivetkit/core",
				"@rivetkit/core/client",
				"@rivetkit/framework-base",
				"esm-env",
			],
			output: {
				preserveModules: false,
				exports: "named",
			},
		},
		sourcemap: true,
		minify: false,
	},
});
