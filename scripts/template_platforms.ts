import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { getExamples } from "../packages/create-actor/src/macros";

async function main() {
	const examples = await getExamples();
	const createActorPath = path.join(
		__dirname,
		"../packages/create-actor/index.js",
	);
	const targetDir = path.join(__dirname, "../templates");

	for (const example of Object.values(examples)) {
		for (const platform of example.supports) {
			spawnSync(
				createActorPath,
				[
					"--overwrite",
					"--template",
					example.slug,
					"--platform",
					platform,
					"--workspace",
					path.join(targetDir, `${example.slug}/${platform}`),
				],
				{ stdio: "inherit" },
			);
		}
	}

	fs.writeFileSync(path.join(targetDir, ".gitignore"), "*\n");
}

main().catch(console.error);
