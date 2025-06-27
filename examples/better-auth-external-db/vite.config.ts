import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
	plugins: [react()],
	root: "src/frontend",
	build: {
		outDir: "../../dist",
	},
	server: {
		host: "0.0.0.0",
	},
});