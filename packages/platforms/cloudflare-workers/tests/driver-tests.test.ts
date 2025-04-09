import { runDriverTests } from "@actor-core/driver-test-suite";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn, exec } from "node:child_process";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { getPort } from "actor-core/test";

const execPromise = promisify(exec);

// Bypass createTestRuntime by providing an endpoint directly
runDriverTests({
	useRealTimers: true,
	HACK_skipCleanupNet: true,
	async start(appPath: string) {
		// Get an available port
		const port = await getPort();
		const inspectorPort = await getPort();

		// Create a temporary directory for the test
		const uuid = crypto.randomUUID();
		const tmpDir = path.join(os.tmpdir(), `actor-core-cloudflare-test-${uuid}`);
		await fs.mkdir(tmpDir, { recursive: true });

		// Create package.json with workspace dependencies
		const packageJson = {
			name: "actor-core-test",
			private: true,
			version: "1.0.0",
			type: "module",
			scripts: {
				start: `wrangler dev --port ${port} --inspector-port ${inspectorPort} --local`,
			},
			dependencies: {
				wrangler: "4.8.0",
				"@actor-core/cloudflare-workers": "workspace:*",
				"actor-core": "workspace:*",
			},
			packageManager:
				"yarn@4.7.0+sha512.5a0afa1d4c1d844b3447ee3319633797bcd6385d9a44be07993ae52ff4facabccafb4af5dcd1c2f9a94ac113e5e9ff56f6130431905884414229e284e37bb7c9",
		};
		await fs.writeFile(
			path.join(tmpDir, "package.json"),
			JSON.stringify(packageJson, null, 2),
		);

		// Disable PnP
		const yarnPnp = "nodeLinker: node-modules";
		await fs.writeFile(path.join(tmpDir, ".yarnrc.yml"), yarnPnp);

		// Get the current workspace root path and link the workspace
		const workspaceRoot = path.resolve(__dirname, "../../../..");
		await execPromise(`yarn link -A ${workspaceRoot}`, { cwd: tmpDir });

		// Install deps
		await execPromise("yarn install", { cwd: tmpDir });

		// Create a wrangler.json file
		const wranglerConfig = {
			name: "actor-core-test",
			main: "src/index.ts",
			compatibility_date: "2025-01-29",
			compatibility_flags: ["nodejs_compat"],
			dev: {
				port,
			},
			migrations: [
				{
					new_classes: ["ActorHandler"],
					tag: "v1",
				},
			],
			durable_objects: {
				bindings: [
					{
						class_name: "ActorHandler",
						name: "ACTOR_DO",
					},
				],
			},
			kv_namespaces: [
				{
					binding: "ACTOR_KV",
					id: "test", // Will be replaced with a mock in dev mode
				},
			],
			observability: {
				enabled: true,
			},
		};
		await fs.writeFile(
			path.join(tmpDir, "wrangler.json"),
			JSON.stringify(wranglerConfig, null, 2),
		);

		// Create src directory
		const srcDir = path.join(tmpDir, "src");
		await fs.mkdir(srcDir, { recursive: true });

		// Write the index.ts file based on the app path
		const indexContent = `import { createHandler } from "@actor-core/cloudflare-workers";
import { app } from "${appPath.replace(/\.ts$/, "")}";

// Create handlers for Cloudflare Workers
const { handler, ActorHandler } = createHandler(app);

// Export the handlers for Cloudflare
export { handler as default, ActorHandler };
`;
		await fs.writeFile(path.join(srcDir, "index.ts"), indexContent);

		// Start wrangler dev
		const wranglerProcess = spawn("yarn", ["start"], {
			cwd: tmpDir,
			stdio: "pipe",
		});

		// Wait for wrangler to start
		await new Promise<void>((resolve, reject) => {
			let isResolved = false;
			const timeout = setTimeout(() => {
				if (!isResolved) {
					isResolved = true;
					wranglerProcess.kill();
					reject(new Error("Timeout waiting for wrangler to start"));
				}
			}, 30000);

			wranglerProcess.stdout?.on("data", (data) => {
				const output = data.toString();
				if (output.includes(`Ready on http://localhost:${port}`)) {
					if (!isResolved) {
						isResolved = true;
						clearTimeout(timeout);
						resolve();
					}
				}
			});

			wranglerProcess.stderr?.on("data", (data) => {
				console.error(`wrangler error: ${data}`);
			});

			wranglerProcess.on("error", (error) => {
				if (!isResolved) {
					isResolved = true;
					clearTimeout(timeout);
					reject(error);
				}
			});

			wranglerProcess.on("exit", (code) => {
				if (!isResolved && code !== 0) {
					isResolved = true;
					clearTimeout(timeout);
					reject(new Error(`wrangler exited with code ${code}`));
				}
			});
		});

		return {
			endpoint: `http://localhost:${port}`,
			async cleanup() {
				// Shut down wrangler process
				wranglerProcess.kill();

				// Clean up temporary directory
				await fs.rm(tmpDir, { recursive: true, force: true });
			},
		};
	},
});
