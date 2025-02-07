import defaultConfig from "../../../tsup.base.ts";
import { defineConfig } from "tsup";

export default defineConfig({
	noExternal: ["@actor-core/redis"],
	...defaultConfig
});
