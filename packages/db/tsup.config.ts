import defaultConfig from "../../tsup.base.ts";
import { defineConfig } from "tsup";

export default defineConfig({
	...defaultConfig,
	external: ["better-sqlite3"],
});
