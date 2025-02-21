import { defineConfig } from "tsup";
import Macros from "unplugin-macros/esbuild";
import { sentryEsbuildPlugin } from "@sentry/esbuild-plugin";

export default defineConfig({
	entry: ["src/index.ts"],
	target: "esnext",
	format: "esm",
	sourcemap: true,
	define: {
		"process.env.SENTRY_DSN": JSON.stringify(process.env.SENTRY_DSN || ""),
	},
	esbuildPlugins: [
		// @ts-ignore
		Macros(),
		sentryEsbuildPlugin({
			authToken: process.env.SENTRY_AUTH_TOKEN,
			org: "rivet-gaming",
			project: "actor-core-cli",
		}),
	],
});
