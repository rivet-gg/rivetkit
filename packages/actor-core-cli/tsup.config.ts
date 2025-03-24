import { sentryEsbuildPlugin } from "@sentry/esbuild-plugin";
import { defineConfig } from "tsup";
import Macros from "unplugin-macros/esbuild";

const createRequireSnippet = `
import { createRequire as topLevelCreateRequire } from "node:module";
import { fileURLToPath as topLevelFileURLToPath, URL as topLevelURL } from "node:url";
const require = topLevelCreateRequire(import.meta.url);
const __filename = topLevelFileURLToPath(import.meta.url);
const __dirname = topLevelFileURLToPath(new topLevelURL(".", import.meta.url));
`;

export default defineConfig({
	entry: ["src/mod.ts", "src/cli.ts"],
	platform: "node",
	bundle: true,
	format: "esm",
	clean: true,
	minify: true,
	shims: true,
	dts: true,
	sourcemap: true,
	external: [
		"yoga-wasm-web",
		"@sentry/profiling-node",
		"bundle-require",
		"esbuild",
	],
	define: {
		"process.env.DEV": JSON.stringify(false),
		"process.env.NODE_ENV": JSON.stringify("production"),
		"process.env.SENTRY_DSN": JSON.stringify(process.env.SENTRY_DSN || ""),
	},
	banner(ctx) {
		return { js: `#!/usr/bin/env node${createRequireSnippet}` };
	},
	esbuildOptions(options) {
		options.alias = {
			...options.alias,
			"react-devtools-core": "./rdt-mock.js",
		};
		return options;
	},
	esbuildPlugins: [
		// @ts-ignore
		Macros(),
		sentryEsbuildPlugin({
			authToken: process.env.SENTRY_AUTH_TOKEN,
			org: "rivet-gaming",
			project: "actor-core-cli",
		}),
		{
			name: "remove-devtools-import",
			setup(build) {
				build.onEnd((result) => {
					result.outputFiles = result.outputFiles?.filter(
						(file) => !file.path.includes("dist/devtools-"),
					);
				});
			},
		},
	],
});
