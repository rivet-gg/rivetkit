import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn, exec } from "node:child_process";
import crypto from "node:crypto";
import { promisify } from "node:util";
import invariant from "invariant";
import type { RivetClientConfig } from "../src/rivet_client";

const execPromise = promisify(exec);
//const RIVET_API_ENDPOINT = "https://api.rivet.gg";
const RIVET_API_ENDPOINT = "http://localhost:8080";
const ENV = "default";

const rivetCloudToken = process.env.RIVET_CLOUD_TOKEN;
invariant(rivetCloudToken, "missing RIVET_CLOUD_TOKEN");
export const RIVET_CLIENT_CONFIG: RivetClientConfig = {
	endpoint: RIVET_API_ENDPOINT,
	token: rivetCloudToken,
};

/**
 * Deploy an app to Rivet and return the endpoint
 */
export async function deployToRivet(appPath: string, deployManager: boolean) {
	console.log("=== START deployToRivet ===");
	console.log(`Deploying app from path: ${appPath}`);

	// Create a temporary directory for the test
	const uuid = crypto.randomUUID();
	const appName = `actor-core-test-${uuid}`;
	const tmpDir = path.join(os.tmpdir(), appName);
	console.log(`Creating temp directory: ${tmpDir}`);
	await fs.mkdir(tmpDir, { recursive: true });

	// Create package.json with workspace dependencies
	const packageJson = {
		name: "actor-core-test",
		private: true,
		version: "1.0.0",
		type: "module",
		scripts: {
			deploy: "actor-core deploy rivet app.ts --env prod",
		},
		dependencies: {
			"@actor-core/rivet": "workspace:*",
			"@actor-core/cli": "workspace:*",
			"actor-core": "workspace:*",
		},
		packageManager:
			"yarn@4.7.0+sha512.5a0afa1d4c1d844b3447ee3319633797bcd6385d9a44be07993ae52ff4facabccafb4af5dcd1c2f9a94ac113e5e9ff56f6130431905884414229e284e37bb7c9",
	};
	console.log("Writing package.json");
	await fs.writeFile(
		path.join(tmpDir, "package.json"),
		JSON.stringify(packageJson, null, 2),
	);

	// Disable PnP
	const yarnPnp = "nodeLinker: node-modules";
	console.log("Configuring Yarn nodeLinker");
	await fs.writeFile(path.join(tmpDir, ".yarnrc.yml"), yarnPnp);

	// Get the current workspace root path and link the workspace
	const workspaceRoot = path.resolve(__dirname, "../../../..");
	console.log(`Linking workspace from: ${workspaceRoot}`);

	try {
		console.log("Running yarn link command...");
		const linkOutput = await execPromise(`yarn link -A ${workspaceRoot}`, {
			cwd: tmpDir,
		});
		console.log("Yarn link output:", linkOutput.stdout);
	} catch (error) {
		console.error("Error linking workspace:", error);
		throw error;
	}

	// Install deps
	console.log("Installing dependencies...");
	try {
		const installOutput = await execPromise("yarn install", { cwd: tmpDir });
		console.log("Install output:", installOutput.stdout);
	} catch (error) {
		console.error("Error installing dependencies:", error);
		throw error;
	}

	// Create app.ts file based on the app path
	const appTsContent = `export { app } from "${appPath.replace(/\.ts$/, "")}"`;
	console.log(`Creating app.ts with content: ${appTsContent}`);
	await fs.writeFile(path.join(tmpDir, "app.ts"), appTsContent);

	// Build and deploy to Rivet using actor-core CLI
	console.log("Building and deploying to Rivet...");

	if (!process.env._RIVET_SKIP_DEPLOY) {
		// Deploy using the actor-core CLI
		console.log("Spawning @actor-core/cli deploy command...");
		const deployProcess = spawn(
			"npx",
			[
				"@actor-core/cli",
				"deploy",
				"rivet",
				"app.ts",
				"--env",
				ENV,
				...(deployManager ? [] : ["--skip-manager"]),
			],
			{
				cwd: tmpDir,
				env: {
					...process.env,
					RIVET_ENDPOINT: RIVET_API_ENDPOINT,
					RIVET_CLOUD_TOKEN: rivetCloudToken,
					_RIVET_MANAGER_LOG_LEVEL: "DEBUG",
					_RIVET_ACTOR_LOG_LEVEL: "DEBUG",
					//CI: "1",
				},
				stdio: "inherit", // Stream output directly to console
			},
		);

		console.log("Waiting for deploy process to complete...");
		await new Promise((resolve, reject) => {
			deployProcess.on("exit", (code) => {
				console.log(`Deploy process exited with code: ${code}`);
				if (code === 0) {
					resolve(undefined);
				} else {
					reject(new Error(`Deploy process exited with code ${code}`));
				}
			});
			deployProcess.on("error", (err) => {
				console.error("Deploy process error:", err);
				reject(err);
			});
		});
		console.log("Deploy process completed successfully");
	}

	// Get the endpoint URL
	console.log("Getting Rivet endpoint...");

	// Get the endpoint using the CLI endpoint command
	console.log("Spawning @actor-core/cli endpoint command...");
	const endpointProcess = spawn(
		"npx",
		["@actor-core/cli", "endpoint", "rivet", "--env", ENV, "--plain"],
		{
			cwd: tmpDir,
			env: {
				...process.env,
				RIVET_ENDPOINT: RIVET_API_ENDPOINT,
				RIVET_CLOUD_TOKEN: rivetCloudToken,
				CI: "1",
			},
			stdio: ["inherit", "pipe", "inherit"], // Capture stdout
		},
	);

	// Capture the endpoint
	let endpointOutput = "";
	endpointProcess.stdout.on("data", (data) => {
		const output = data.toString();
		console.log(`Endpoint output: ${output}`);
		endpointOutput += output;
	});

	// Wait for endpoint command to complete
	console.log("Waiting for endpoint process to complete...");
	await new Promise((resolve, reject) => {
		endpointProcess.on("exit", (code) => {
			console.log(`Endpoint process exited with code: ${code}`);
			if (code === 0) {
				resolve(undefined);
			} else {
				reject(new Error(`Endpoint command failed with code ${code}`));
			}
		});
		endpointProcess.on("error", (err) => {
			console.error("Endpoint process error:", err);
			reject(err);
		});
	});

	invariant(endpointOutput, "endpoint command returned empty output");
	console.log(`Raw endpoint output: ${endpointOutput}`);

	// Look for something that looks like a URL in the string
	const lines = endpointOutput.trim().split("\n");
	const endpoint = lines[lines.length - 1];
	invariant(endpoint, "endpoint not found");

	console.log("=== END deployToRivet ===");

	return {
		endpoint,
	};
}
