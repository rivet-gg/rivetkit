import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getExamples } from "../packages/actor-core-cli/src/macros";

async function main() {
	const examples = await getExamples();
	const createActorPath = path.join(
		__dirname,
		"../packages/create-actor/dist/cli.js",
	);
	const targetDir = path.join(__dirname, "../templates");

	if (!fs.existsSync(targetDir)) {
		fs.mkdirSync(targetDir);
	}

	for (const example of Object.values(examples)) {
		for (const platform of example.supports) {
			console.log(`Templating ${example.slug}@${platform}`);

			const packageName = `${example.slug}-${platform}`;
			const platformDir = path.join(targetDir, packageName);

			if (fs.existsSync(platformDir)) {
				fs.rmSync(platformDir, { recursive: true });
			}

			const res = spawnSync(
				createActorPath,
				[
					path.relative(process.cwd(), platformDir),
					"--package-name",
					packageName,
					"--template",
					example.slug,
					"--platform",
					platform,
					"--actor-core-version", "workspace:*",
					"--skip-install",
				],
				{
					stdio: "inherit",
					env: Object.assign({}, process.env, {
						_ACTOR_CORE_CLI_DEV_TEMPLATE: "1",
					}),
				},
			);
			if (res.error) {
				console.error(`Spawn failed: ${res.error}`);
				process.exit(1);
			} else if (res.status !== 0) {
				console.error(`Error: ${res.status}`);
				process.exit(1);
			}
		}
	}

	fs.writeFileSync(path.join(targetDir, ".gitignore"), "*\n");
}

main().catch(console.error);
