import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dts from "vite-plugin-dts";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	plugins: [react(), dts({ include: ["lib"] })],
	build: {
		lib: {
			entry: resolve(__dirname, "lib/mod.ts"),
		},
		rollupOptions: {
			external: ["react", "react/jsx-runtime"],
		},
	},
});
