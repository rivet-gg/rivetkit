#!/usr/bin/env tsx
import * as semver from "semver";
import { $, chalk, argv } from "zx";

async function main() {
	// Clean the workspace first
	await cleanWorkspace();

	// Check if cargo, maturin etc. exist
	await checkRustEnvironment();
	await checkPythonEnvironment();

	// Update version
	const version = getVersionFromArgs();
	await bumpPackageVersions(version);
	await updateRustClientVersion(version);
	// await updatePythonClientVersion(version);

	// IMPORTANT: Do this after bumping the version
	// Check & build
	await runTypeCheck();
	await runRustCheck();
	await runBuild();

	// Commit
	await commitVersionChanges(version);

	// Get packages ready for publishing
	const publicPackages = await getPublicPackages();
	validatePackages(publicPackages);

	// Publish
	await publishPackages(publicPackages, version);
	await publishRustClient(version);
	//await publishPythonClient(version);  // TODO: Add back

	// Create GitHub release
	await createAndPushTag(version);
	await createGitHubRelease(version);
}

async function runTypeCheck() {
	console.log(chalk.blue("Running type check..."));
	return;
	try {
		// --force to skip cache in case of Turborepo bugs
		await $`pnpm check-types --force`;
		console.log(chalk.green("✅ Type check passed"));
	} catch (err) {
		console.error(chalk.red("❌ Type check failed"));
		process.exit(1);
	}
}

async function runBuild() {
	console.log(chalk.blue("Running build..."));
	try {
		// --force to skip cache in case of Turborepo bugs
		await $`pnpm build --force`;
		console.log(chalk.green("✅ Build finished"));
	} catch (err) {
		console.error(chalk.red("❌ Build failed"));
		process.exit(1);
	}
}

async function updateRustClientVersion(version: string) {
	console.log(chalk.blue(`Updating Rust client version to ${version}...`));
	const cargoTomlPath = "clients/rust/Cargo.toml";

	try {
		// Replace version in Cargo.toml
		await $`sed -i.bak -e 's/^version = ".*"/version = "${version}"/' ${cargoTomlPath}`;
		await $`rm ${cargoTomlPath}.bak`;
		console.log(chalk.green("✅ Updated Rust client version"));
	} catch (err) {
		console.error(chalk.red("❌ Failed to update Rust client version"), err);
		process.exit(1);
	}
}

// async function updatePythonClientVersion(version: string) {
// 	console.log(chalk.blue(`Updating Python client version to ${version}...`));
// 	const pyprojectTomlPath = "clients/python/pyproject.toml";
// 	const pyCargoTomlPath = "clients/python/Cargo.toml";

// 	try {
// 		// Replace version in pyproject.toml and Cargo.toml
// 		await $`sed -i.bak -e 's/^version = ".*"/version = "${version}"/' ${pyprojectTomlPath}`;
// 		await $`sed -i.bak -e 's/^version = ".*"/version = "${version}"/' ${pyCargoTomlPath}`;
// 		await $`rm ${pyprojectTomlPath}.bak`;
// 		await $`rm ${pyCargoTomlPath}.bak`;
// 		console.log(chalk.green("✅ Updated Python client version"));
// 	} catch (err) {
// 		console.error(chalk.red("❌ Failed to update Python client version"), err);
// 		process.exit(1);
// 	}
// }

async function runRustCheck() {
	console.log(chalk.blue("Running cargo check for Rust client..."));
	try {
		await $`cargo check`;
		console.log(chalk.green("✅ Rust client check passed"));
	} catch (err) {
		console.error(chalk.red("❌ Rust client check failed"), err);
		process.exit(1);
	}
}

async function cleanWorkspace() {
	console.log(chalk.blue("Cleaning workspace..."));
	try {
		await $`git clean -fdx`;
		console.log(chalk.green("✅ Workspace cleaned"));
	} catch (err) {
		console.error(chalk.red("❌ Failed to clean workspace"), err);
		process.exit(1);
	}
}

async function createAndPushTag(version: string) {
	console.log(chalk.blue(`Creating tag v${version}...`));
	try {
		// Create tag and force update if it exists
		await $`git tag -f v${version}`;

		// Push tag with force to ensure it's updated
		await $`git push origin v${version} -f`;

		console.log(chalk.green(`✅ Tag v${version} created and pushed`));
	} catch (err) {
		console.error(chalk.red("❌ Failed to create or push tag"), err);
		process.exit(1);
	}
}

async function publishRustClient(version: string) {
	console.log(chalk.blue("Publishing Rust client..."));

	try {
		// First check if we need to update the publish flag in Cargo.toml
		const cargoTomlPath = "clients/rust/Cargo.toml";
		const { stdout: cargoToml } = await $`cat ${cargoTomlPath}`;

		// Check if publish = false is set and update it if needed
		if (cargoToml.includes("publish = false")) {
			await $`sed -i.bak -e 's/publish = false/publish = true/' ${cargoTomlPath}`;
			await $`rm ${cargoTomlPath}.bak`;
			console.log(chalk.blue("Updated publish flag in Cargo.toml"));
		}

		// Check if package already exists
		const { exitCode } = await $({
			nothrow: true,
		})`cargo search rivetkit-client --limit 1 | grep "rivetkit-client = \\"${version}\\""`;

		if (exitCode === 0) {
			console.log(
				chalk.yellow(
					`! Rust package rivetkit-client@${version} already published, skipping`,
				),
			);
			return;
		}

		// Publish the crate
		await $({ stdio: "inherit" })`cd clients/rust && cargo publish`;

		console.log(chalk.green("✅ Published Rust client"));
	} catch (err) {
		console.error(chalk.red("❌ Failed to publish Rust client"), err);
		process.exit(1);
	}
}

async function publishPythonClient(version: string) {
	console.log(chalk.blue("Publishing Python client..."));

	try {
		// Check if package already exists
		const res = await fetch(
			"https://test.pypi.org/pypi/rivetkit-client/json",
		);
		if (res.ok) {
			const data = await res.json();
			const doesAlreadyExist = typeof data.releases[version] !== "undefined";

			if (doesAlreadyExist) {
				console.log(
					chalk.yellow(
						`! Python pypi package rivetkit-client@${version} already published, skipping`,
					),
				);
				return;
			}
		}

		const token = process.env["PYPI_TOKEN"];
		if (!token) {
			console.error(
				chalk.red("❌ Missing PyPi credentials (PYPI_TOKEN env var)"),
			);
			process.exit(1);
		}

		const username = "__token__";
		const password = token;

		// Publish the crate
		await $({ stdio: "inherit" })`cd clients/python &&\
			maturin publish\
				--repository-url "https://test.pypi.org/legacy/"\
				--username ${username}\
				--password ${password}\
				--skip-existing\
		`;

		console.log(chalk.green("✅ Published Python client"));
	} catch (err) {
		console.error(chalk.red("❌ Failed to publish Python client"), err);
		process.exit(1);
	}
}

async function checkRustEnvironment() {
	console.log(chalk.blue("Checking Rust environment..."));

	// Check if cargo is installed
	try {
		const { stdout: versionText } = await $`cargo --version`;

		const version = versionText.split(" ")[1];

		if (!semver.gte(version, "1.8.0")) {
			console.error(chalk.red("❌ Rust version is too old"));
			console.error(chalk.red("Please update Rust to at least 1.8.0"));
			process.exit(1);
		}
	} catch (err) {
		console.error(chalk.red("❌ Rust environment is not ready"));
		console.error(
			chalk.red(
				"Please install Rust and Cargo\n(remember to `cargo login` afterwards)",
			),
		);
		process.exit(1);
	}
	console.log(chalk.green("✅ Rust environment is good"));
}

async function checkPythonEnvironment() {
	console.log(chalk.blue("Checking Python environment..."));

	// Check if pypi is installed
	try {
		const { stdout: versionText } = await $`pip --version`;

		const version = versionText.split(" ")[1];

		if (!semver.gte(version, "23.2.1")) {
			console.error(chalk.red("❌ Python pip version is too old"));
			console.error(chalk.red("Please update Python pip to at least 23.2.1"));
			process.exit(1);
		}
	} catch (err) {
		console.error(chalk.red("❌ Python environment is not ready"));
		console.error(chalk.red("Please install Python and pip"));
		process.exit(1);
	}

	// Check if maturin is installed
	try {
		await $`maturin --version`;
	} catch (err) {
		console.error(chalk.red("❌ Maturin is not installed"));
		console.error(chalk.red("Please install [Maturin](https://maturin.rs)"));
		process.exit(1);
	}

	// Check if PYPI_TOKEN exists
	if (!process.env["PYPI_TOKEN"]) {
		console.error(
			chalk.red("❌ Missing PyPi credentials (PYPI_TOKEN env var)"),
		);
		process.exit(1);
	}

	console.log(chalk.green("✅ Python environment is good"));
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
		console.error(
			chalk.yellow("Version must be in format x.x.x or x.x.x-rc.x"),
		);
		process.exit(1);
	}

	return version;
}

async function bumpPackageVersions(version: string) {
	console.log(chalk.blue(`Setting version to ${version}...`));
	await $`pnpm workspaces foreach -A -t version ${version}`;
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
}

async function getPublicPackages() {
	console.log(chalk.blue("Getting list of public packages..."));
	const { stdout: packagesStdout } =
		await $`pnpm workspaces list --json --no-private`;

	return packagesStdout
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
}

function validatePackages(publicPackages: any[]) {
	const nonRivetKitPackages = publicPackages.filter(
		(pkg) =>
			pkg.name !== "rivetkit" &&
			pkg.name !== "create-actor" &&
			!pkg.name.startsWith("@rivetkit/"),
	);

	if (nonRivetKitPackages.length > 0) {
		console.error(
			chalk.red("Error: Found non-rivetkit packages in public packages:"),
		);
		for (const pkg of nonRivetKitPackages) {
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
		chalk.blue(`Found ${publicPackages.length} rivetkit packages to publish`),
	);
}

async function publishPackages(publicPackages: any[], version: string) {
	console.log(chalk.blue("Publishing packages..."));

	for (const pkg of publicPackages) {
		await publishPackage(pkg, version);
	}

	console.log(chalk.green(`✅ Published all packages at version ${version}`));
}

async function createGitHubRelease(version: string) {
	console.log(chalk.blue("Creating GitHub release..."));

	try {
		// Get the current tag name (should be the tag created during the release process)
		const { stdout: currentTag } = await $`git describe --tags --exact-match`;
		const tagName = currentTag.trim();

		console.log(chalk.blue(`Looking for existing release for ${version}`));

		// Check if a release with this version name already exists
		const { stdout: releaseJson } =
			await $`gh release list --json name,tagName`;
		const releases = JSON.parse(releaseJson);
		const existingRelease = releases.find((r: any) => r.name === version);

		if (existingRelease) {
			console.log(
				chalk.blue(
					`Updating release ${version} to point to new tag ${tagName}`,
				),
			);
			await $`gh release edit ${existingRelease.tagName} --tag ${tagName}`;
		} else {
			console.log(
				chalk.blue(
					`Creating new release ${version} pointing to tag ${tagName}`,
				),
			);
			await $`gh release create ${tagName} --title ${version} --draft --generate-notes`;

			// Check if this is a pre-release (contains -rc. or similar)
			if (version.includes("-")) {
				await $`gh release edit ${tagName} --prerelease`;
			}
		}

		// Check if we have a dist directory with artifacts to upload
		const { exitCode } = await $({ nothrow: true })`test -d dist`;
		if (exitCode === 0) {
			console.log(chalk.blue(`Uploading artifacts for tag ${tagName}`));
			await $`gh release upload ${tagName} dist/* --clobber`;
		}

		console.log(chalk.green("✅ GitHub release created/updated"));
	} catch (err) {
		console.error(chalk.red("❌ Failed to create GitHub release"), err);
		console.warn(chalk.yellow("! You may need to create the release manually"));
	}
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
		})`pnpm workspace ${name} npm publish --access public --tag ${tag}`;

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
