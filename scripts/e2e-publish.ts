#!/usr/bin/env tsx
import { $, chalk, fs } from "zx";

async function getPublicPackages() {
	console.log(chalk.blue("Getting list of public packages..."));
	const { stdout: packagesStdout } =
		await $`yarn workspaces list --json --no-private`;

	return packagesStdout
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
}

async function saveYarnrc() {
	const contents = await fs.promises.readFile(".yarnrc.yml", "utf-8");

	return {
		async restore() {
			await fs.promises.writeFile(".yarnrc.yml", contents);
		},
	};
}

async function setupYarn() {
	// generate token
	await $`npx npm-cli-login -u test -p 1234 -e test@domain.test -r http://0.0.0.0:4873 --config-path .npmrc`;

	const npmrc = await fs.promises.readFile(".npmrc", "utf-8");
	const [, token] = npmrc.split("=");

	await $`yarn config set npmRegistryServer http://0.0.0.0:4873`;
	await $`yarn config set unsafeHttpWhitelist --json '["0.0.0.0"]'`;
	await $`yarn config set npmAlwaysAuth false`;
	await $`yarn config set enableStrictSsl false`;
	await $`yarn config set npmAuthToken "${token}"`;
}

async function run() {
	const yarnrc = await saveYarnrc();

	try {
		await setupYarn();

		const pkgs = await getPublicPackages();

		// publish
		for (const pkg of pkgs) {
			console.log(chalk.blue(`Publishing package ${pkg.name}...`));
			await $({
				stdio: "inherit",
			})`yarn workspace ${pkg.name} npm publish --access public`;
		}
	} finally {
		await yarnrc.restore();
	}
}

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
