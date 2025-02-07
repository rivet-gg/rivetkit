// Import necessary modules
import { spawn, execSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Determine the current file and directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define platforms
const platforms = ["nodejs", "bun"];

// Function to flush Redis
function flushRedis(): void {
	//console.log("Flushing Redis...");
	spawnSync("docker", ["exec", "redis-server", "redis-cli", "flushdb"]);
}

// Function to spawn a server process
function spawnServer(
	platform: string,
): Promise<import("child_process").ChildProcess> {
	//console.log(`Spawning server for platform: ${platform}`);
	const isBun = platform === "bun";
	const serverProcess = spawn(isBun ? "bun" : "tsx", ["src/index.ts"], {
		cwd: path.resolve(__dirname, `../platforms/${platform}`),
		detached: true,
		stdio: "ignore",
	});

	// Give process time to boot
	return new Promise((resolve) =>
		setTimeout(() => resolve(serverProcess), 500),
	);
}

// Function to run rtt.ts
function runRTT(platform: string): void {
	//console.log(`Running rtt.ts with platform: ${platform}`);
	const isBun = platform === "bun";
	const command = isBun ? "bun" : "tsx";
	spawnSync(command, ["./rtt.ts"], {
		cwd: __dirname,
		stdio: "inherit",
	});
}

// Main function to iterate through platforms
async function main(): Promise<void> {
	for (const platform of platforms) {
		console.log();
		console.log("======================================");
		console.log(`        Benchmarking ${platform}          `);
		console.log("======================================");
		console.log();
		flushRedis();
		const serverProcess = await spawnServer(platform);
		try {
			runRTT(platform);
		} finally {
			// Ensure the server process is killed
			serverProcess.kill("SIGKILL");
		}
	}
}

main();
