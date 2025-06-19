import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn, exec } from "node:child_process";
import crypto from "node:crypto";
import { promisify } from "node:util";
import invariant from "invariant";
import { RivetClient } from "@rivet-gg/api";
import { RivetClientConfig } from "../src/rivet-client";

const execPromise = promisify(exec);
const apiEndpoint = process.env.RIVET_ENDPOINT!;
invariant(apiEndpoint, "missing RIVET_ENDPOINT");
const rivetCloudToken = process.env.RIVET_CLOUD_TOKEN!;
invariant(rivetCloudToken, "missing RIVET_CLOUD_TOKEN");
const project = process.env.RIVET_PROJECT!;
invariant(project, "missing RIVET_PROJECT");
const environment = process.env.RIVET_ENVIRONMENT!;
invariant(environment, "missing RIVET_ENVIRONMENT");

export const rivetClientConfig: RivetClientConfig = {
	endpoint: apiEndpoint,
	token: rivetCloudToken,
	project,
	environment,
};

const rivetClient = new RivetClient({
	environment: apiEndpoint,
	token: rivetCloudToken,
});

/**
 * Helper function to write a file to the filesystem
 */
async function writeFile(
	dirPath: string,
	filename: string,
	content: string | object,
): Promise<void> {
	const filePath = path.join(dirPath, filename);
	const fileContent =
		typeof content === "string" ? content : JSON.stringify(content, null, 2);

	console.log(`Writing ${filename}`);
	await fs.writeFile(filePath, fileContent);
}

/**
 * Pack a package using pnpm pack and return the path to the packed tarball
 */
async function packPackage(
	packageDir: string,
	tmpDir: string,
	packageName: string,
): Promise<string> {
	console.log(`Packing package from ${packageDir}...`);
	// Generate a unique filename
	const outputFileName = `${packageName}-${crypto.randomUUID()}.tgz`;
	const outputPath = path.join(tmpDir, outputFileName);

	// Run pnpm pack with specific output path
	await execPromise(`pnpm pack --install-if-needed --out ${outputPath}`, {
		cwd: packageDir,
	});
	console.log(`Generated tarball at ${outputPath}`);
	return outputFileName;
}

/**
 * Deploy an app to Rivet and return the endpoint
 */
export async function deployToRivet(projectPath: string) {
	console.log("=== START deployToRivet ===");
	console.log(`Deploying registry from path: ${projectPath}`);

	// Create a temporary directory for the test
	const uuid = crypto.randomUUID();
	const tmpDirName = `rivetkit-test-${uuid}`;
	const tmpDir = path.join(os.tmpdir(), tmpDirName);
	console.log(`Creating temp directory: ${tmpDir}`);
	await fs.mkdir(tmpDir, { recursive: true });

	// Get the workspace root and package paths
	const workspaceRoot = path.resolve(__dirname, "../../../..");
	const rivetPlatformPath = path.resolve(__dirname, "../");
	const rivetkitCorePath = path.resolve(workspaceRoot, "packages/core");

	// Pack the required packages directly to the temp directory
	console.log("Packing required packages...");
	const rivetPlatformFilename = await packPackage(
		rivetPlatformPath,
		tmpDir,
		"rivetkit-rivet",
	);
	const rivetkitFilename = await packPackage(
		rivetkitCorePath,
		tmpDir,
		"rivetkit",
	);

	// Create package.json with file dependencies
	const packageJson = {
		name: "rivetkit-test",
		private: true,
		version: "1.0.0",
		scripts: {
			build: "tsc",
		},
		dependencies: {
			"@rivetkit/rivet": `file:./${rivetPlatformFilename}`,
			rivetkit: `file:./${rivetkitFilename}`,
		},
		devDependencies: {
			typescript: "^5.3.0",
		},
		packageManager:
			"pnpm@10.7.1+sha512.2d92c86b7928dc8284f53494fb4201f983da65f0fb4f0d40baafa5cf628fa31dae3e5968f12466f17df7e97310e30f343a648baea1b9b350685dafafffdf5808",
	};
	await writeFile(tmpDir, "package.json", packageJson);

	// Create rivet.json with workspace dependencies
	const rivetJson = {
		functions: {
			manager: {
				tags: { role: "manager", framework: "rivetkit" },
				dockerfile: "Dockerfile",
				runtime: {
					environment: {
						RIVET_API_ENDPOINT: apiEndpoint,
						RIVET_SERVICE_TOKEN: rivetCloudToken, // TODO: This should be a service token, but both work
						RIVET_PROJECT: project,
						RIVET_ENVIRONMENT: environment,
						_LOG_LEVEL: "DEBUG",
						_WORKER_LOG_LEVEL: "DEBUG",
					},
				},
				resources: {
					cpu: 250,
					memory: 256,
				},
			},
		},
		actors: {
			worker: {
				tags: { role: "worker", framework: "rivetkit" },
				script: "src/worker.ts",
			},
		},
	};
	await writeFile(tmpDir, "rivet.json", rivetJson);

	// Create Dockerfile
	const dockerfile = `
FROM node:22-alpine AS builder

RUN npm i -g corepack && corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
COPY *.tgz ./

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .
# HACK: Remove worker.ts bc file is invalid in Node
RUN rm src/worker.ts && pnpm build

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile

FROM node:22-alpine AS runtime

RUN addgroup -g 1001 -S rivet && \
    adduser -S rivet -u 1001 -G rivet

WORKDIR /app

COPY --from=builder --chown=rivet:rivet /app/dist ./dist
COPY --from=builder --chown=rivet:rivet /app/node_modules ./node_modules
COPY --from=builder --chown=rivet:rivet /app/package.json ./

USER rivet

CMD ["node", "dist/server.js"]
`;
	await writeFile(tmpDir, "Dockerfile", dockerfile);

	// Create .dockerignore
	const dockerignore = `
node_modules
`;
	await writeFile(tmpDir, ".dockerignore", dockerignore);

	// Disable PnP
	const yarnPnp = "nodeLinker: node-modules";
	await writeFile(tmpDir, ".yarnrc.yml", yarnPnp);

	// Create tsconfig.json
	const tsconfig = {
		compilerOptions: {
			target: "ESNext",
			module: "NodeNext",
			moduleResolution: "NodeNext",
			esModuleInterop: true,
			strict: true,
			skipLibCheck: true,
			forceConsistentCasingInFileNames: true,
			outDir: "dist",
			sourceMap: true,
			declaration: true,
		},
		include: ["src/**/*.ts"],
	};
	await writeFile(tmpDir, "tsconfig.json", tsconfig);

	// Install deps
	console.log("Installing dependencies...");
	try {
		const installOutput = await execPromise("pnpm install", { cwd: tmpDir });
		console.log("Install output:", installOutput.stdout);
	} catch (error) {
		console.error("Error installing dependencies:", error);
		throw error;
	}

	// Copy project to test directory
	console.log(`Copying project from ${projectPath} to ${tmpDir}/src/workers`);
	const projectDestDir = path.join(tmpDir, "src", "workers");
	await fs.cp(projectPath, projectDestDir, { recursive: true });

	const serverTsContent = `import { startManager } from "@rivetkit/rivet/manager";
import { registry } from "./workers/registry";

// TODO: Find a cleaner way of flagging an registry as test mode (ideally not in the config itself)
// Force enable test
registry.config.test.enabled = true;

startManager(registry);
`;
	await writeFile(tmpDir, "src/server.ts", serverTsContent);

	const workerTsContent = `import { createWorkerHandler } from "@rivetkit/rivet/worker";
import { registry } from "./workers/registry";

// TODO: Find a cleaner way of flagging an registry as test mode (ideally not in the config itself)
// Force enable test
registry.config.test.enabled = true;

export default createWorkerHandler(registry);`;
	await writeFile(tmpDir, "src/worker.ts", workerTsContent);

	// Build and deploy to Rivet
	console.log("Building and deploying to Rivet...");

	if (!process.env._RIVET_SKIP_DEPLOY) {
		// Deploy using the rivet CLI
		console.log("Spawning rivet deploy command...");
		const deployProcess = spawn(
			"rivet",
			["deploy", "--environment", environment, "--non-interactive"],
			{
				cwd: tmpDir,
				env: {
					...process.env,
					RIVET_ENDPOINT: apiEndpoint,
					RIVET_CLOUD_TOKEN: rivetCloudToken,
					//CI: "1",
				},
				stdio: "inherit", // Stream output directly to console
			},
		);

		console.log("Waiting for deploy process to complete...");
		await new Promise((resolve, reject) => {
			deployProcess.on("exit", (code) => {
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

	// // HACK: We have to get the endpoint of the actor directly since we can't route functions with hostnames on localhost yet
	// const { actors } = await rivetClient.actors.list({
	// 	tagsJson: JSON.stringify({
	// 		type: "function",
	// 		function: "manager",
	// 		appName,
	// 	}),
	// 	project,
	// 	environment,
	// });
	// const managerActor = actors[0];
	// invariant(managerActor, "missing manager actor");
	// const endpoint = managerActor.network.ports.http?.url;
	// invariant(endpoint, "missing manager actor endpoint");

	// TODO: This doesn't work in local dev since we can't route functions on localhost yet
	// Get the endpoint using the CLI endpoint command
	console.log("Spawning rivet function endpoint command...");
	const endpointProcess = spawn(
		"rivet",
		["function", "endpoint", "--environment", environment, "manager"],
		{
			cwd: tmpDir,
			env: {
				...process.env,
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

	console.log("Manager endpoint", endpoint);

	console.log("=== END deployToRivet ===");

	return endpoint;
}
