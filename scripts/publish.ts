#!/usr/bin/env tsx
import { $, chalk, argv } from "zx";

async function main() {
	await runTypeCheck();
	const version = getVersionFromArgs();
	await bumpPackageVersions(version);
	await commitVersionChanges(version);
	const publicPackages = await getPublicPackages();
	validatePackages(publicPackages);
	await publishPackages(publicPackages, version);
}

async function runTypeCheck() {
	console.log(chalk.blue("Running type check..."));
	try {
		// --force to skip cache in case of Turborepo bugs
		await $`yarn check-types --force`;
		console.log(chalk.green("✅ Type check passed"));
	} catch (err) {
		console.error(chalk.red("❌ Type check failed"));
		process.exit(1);
	}
}

function getVersionFromArgs() {
	const version = argv._[0];

	if (!version) {
		console.error("Usage: tsx publish.ts <version>");
		process.exit(1);
	}

	// Validate version format (x.x.x or x.x.x-rc.x)
	const versionRegex = /^\d+\.\d+\.\d+(-rc\.\d+)?$/;
	if (!versionRegex.test(version)) {
		console.error(chalk.red(`Invalid version format: ${version}`));
		console.error(chalk.yellow("Version must be in format x.x.x or x.x.x-rc.x"));
		process.exit(1);
	}

	return version;
}

async function bumpPackageVersions(version: string) {
	console.log(chalk.blue(`Setting version to ${version}...`));
	await $`yarn workspaces foreach -A -t version ${version}`;
}

async function commitVersionChanges(version: string) {
	console.log(chalk.blue("Committing..."));
	await $`git add .`;

	// Check if there are changes to commit
	const { stdout: statusOutput } = await $`git status --porcelain`;
	if (statusOutput.trim()) {
		console.log(chalk.blue("Changes detected, committing version changes..."));
		await $`git commit -m "chore: release version ${version}"`;
	} else {
		console.log(chalk.yellow("No changes to commit for version bump"));
	}

	await $`git commit --allow-empty -m "chore: release ${version}" -m "Release-As: ${version}"`;

	const { exitCode: pushExitCode } = await $({ nothrow: true })`git push`;
	if (pushExitCode !== 0) {
		console.warn(
			chalk.yellow("! Failed to push branch. You may need to push manually."),
		);
	}

	await $`git push --tags -f`;
}

async function getPublicPackages() {
	console.log(chalk.blue("Getting list of public packages..."));
	const { stdout: packagesStdout } =
		await $`yarn workspaces list --json --no-private`;

	return packagesStdout
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
}

function validatePackages(publicPackages: any[]) {
	const nonActorCorePackages = publicPackages.filter(
		(pkg) =>
			pkg.name !== "actor-core" &&
			pkg.name !== "create-actor" &&
			!pkg.name.startsWith("@actor-core/"),
	);

	if (nonActorCorePackages.length > 0) {
		console.error(
			chalk.red("Error: Found non-actor-core packages in public packages:"),
		);
		for (const pkg of nonActorCorePackages) {
			console.error(chalk.red(`  - ${pkg.name} (${pkg.location})`));
		}
		console.error(
			chalk.red(
				"Please ensure these packages are marked as private or have correct naming.",
			),
		);
		process.exit(1);
	}

	console.log(
		chalk.blue(`Found ${publicPackages.length} actor-core packages to publish`),
	);
}

async function publishPackages(publicPackages: any[], version: string) {
	console.log(chalk.blue("Publishing packages..."));

	for (const pkg of publicPackages) {
		await publishPackage(pkg, version);
	}

	console.log(chalk.green(`✅ Published all packages at version ${version}`));
	console.log(chalk.yellow("! Make sure to merge Release Please"));
}

async function publishPackage(pkg: any, version: string) {
	const { name } = pkg;

	try {
		console.log(chalk.cyan(`Publishing ${name}...`));

		// Check if package with this version already exists
		const { exitCode } = await $({
			nothrow: true,
		})`npm view ${name}@${version} version`;
		if (exitCode === 0) {
			console.log(
				chalk.yellow(
					`! Package ${name}@${version} already published, skipping`,
				),
			);
			return;
		}

		// Add --tag flag for release candidates
		const isReleaseCandidate = version.includes("-rc.");
		const tag = isReleaseCandidate ? "rc" : "latest";
		
		await $({
			stdio: "inherit",
		})`yarn workspace ${name} npm publish --access public --tag ${tag}`;

		console.log(chalk.green(`✅ Published ${name} with tag '${tag}'`));
	} catch (err) {
		console.error(chalk.red(`Error publishing package ${name}:`), err);
		process.exit(1);
	}
}

main().catch((err) => {
	console.error(chalk.red("Error:"), err);
	process.exit(1);
});
