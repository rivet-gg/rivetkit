import type { LoadHook } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const load: LoadHook = async (url, context, nextLoad) => {
	if (url.endsWith(".sql")) {
		return {
			shortCircuit: true,
			format: "module",
			source: `export default \`${(await readFile(fileURLToPath(url), "utf8")).replace(/`/gm, "\\`")}\`;`,
		};
	}
	return nextLoad(url, context);
};
