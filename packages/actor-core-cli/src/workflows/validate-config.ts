import {
	isBundleError,
	isNotFoundError,
	validateConfig,
} from "../utils/config";
import path from "node:path";
import type { Context } from "../workflow";

export function validateConfigTask(
	ctx: Context,
	cwd: string,
	appPath?: string,
) {
	return ctx.task("Build project", async () => {
		try {
			return await validateConfig(cwd, appPath);
		} catch (error) {
			if (isBundleError(error)) {
				throw ctx.error(
					`Could not parse Actors index file (${error.path})\n${error.details}`,
					{
						hint: "Please make sure that the file exists and does not have any syntax errors.",
					},
				);
			} else if (isNotFoundError(error)) {
				throw ctx.error(
					`Could not find Actors index file (${error.path ? error.path : path.join(error.cwd, "src/app.{ts,tsx,mts,js,cjs,mjs}")})`,
					{
						hint: "Please make sure that the file exists and not empty.",
					},
				);
			} else {
				console.error(error);
				throw ctx.error("Failed to build project config.", {
					hint: "Please check the logs above for more information.",
				});
			}
		}
	});
}
