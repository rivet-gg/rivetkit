import fs from "fs";
import path from "path";
import dedent from "dedent";
import { z } from "zod";
import { stringifyJson } from "./utils";

const PackageJsonSchema = z.object({
	name: z.string(),
	example: z.object({
		platforms: z.array(z.string()),
		actors: z.record(z.string()),
	}),
	devDependencies: z.record(z.string()),
	scripts: z.record(z.string()).optional().default({}),
});

type PackageJson = z.infer<typeof PackageJsonSchema>;

interface PlatformInput {
	path: string;
	packageJson: PackageJson;
}

interface PlatformOutput {
	files: Record<string, string>;
}

type PlatformConfigFn = (build: PlatformInput) => PlatformOutput;

const PLATFORMS: Record<string, PlatformConfigFn> = {
	rivet: (input) => {
		input.packageJson.name += "-rivet";
		input.packageJson.devDependencies = {
			"@actor-core/rivet": "workspace:*",
			...input.packageJson.devDependencies,
		};

		const files = {
			"package.json": stringifyJson(input.packageJson),
			"src/_manager.ts": dedent`
				import { createManagerHandler } from "@actor-core/rivet";
				export default createManagerHandler({ actors: {} });
				`,
		};
		const rivetJson = {
			builds: {
				manager: {
					script: "src/_manager.ts",
					access: "private",
				},
			},
			unstable: {
				manager: {
					enable: false,
				},
			},
		};

		for (const [name, script] of Object.entries(
			input.packageJson.example.actors,
		)) {
			files[`src/${name}.ts`] = dedent`
			import { createActorHandler } from "@actor-core/rivet"
			import Actor from "../../../${script.replace(/\.ts$/, "")}";
			export default createActorHandler({
				actors: {
					${JSON.stringify(name)}: Actor
				}
			});
			`;
			rivetJson.builds[name] = { script, access: "public" };
		}

		files["rivet.json"] = stringifyJson(rivetJson);

		return {
			files,
		};
	},
	"cloudflare-workers": (input) => {
		input.packageJson.name += "-cloudflare-workers";
		input.packageJson.devDependencies = {
			"@actor-core/cloudflare-workers": "workspace:*",
			wrangler: "^3.101.0",
			"@cloudflare/workers-types": "^4.20250129.0",
			...input.packageJson.devDependencies,
		};
		input.packageJson.scripts = {
			deploy: "wrangler deploy",
			dev: "wrangler dev",
			start: "wrangler dev",
			"cf-typegen": "wrangler types",
			...input.packageJson.scripts,
		};

		const { actorImports, actorList } = buildActorImports(input);

		return {
			files: {
				"package.json": stringifyJson(input.packageJson),
				"wrangler.json": stringifyJson({
					name: "counter",
					main: "src/index.ts",
					compatibility_date: "2025-01-29",
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
							id: "TODO",
						},
					],
					observability: {
						enabled: true,
					},
				}),
				"src/index.ts": dedent`
				import { createHandler } from "@actor-core/cloudflare-workers";
				${actorImports}

				const { handler, ActorHandler } = createHandler({
					actors: { ${actorList} }
				});

				export { handler as default, ActorHandler };
                `,
			},
		};
	},
	"cloudflare-workers-custom-path": (input) => {
		input.packageJson.name += "-cloudflare-workers-custom-path";
		input.packageJson.devDependencies = {
			hono: "^4.7.0",
			"@actor-core/cloudflare-workers": "workspace:*",
			wrangler: "^3.101.0",
			"@cloudflare/workers-types": "^4.20250129.0",
			...input.packageJson.devDependencies,
		};
		input.packageJson.scripts = {
			deploy: "wrangler deploy",
			dev: "wrangler dev",
			start: "wrangler dev",
			"cf-typegen": "wrangler types",
			...input.packageJson.scripts,
		};

		const { actorImports, actorList } = buildActorImports(input);

		return {
			files: {
				"package.json": stringifyJson(input.packageJson),
				"wrangler.json": stringifyJson({
					name: "counter",
					main: "src/index.ts",
					compatibility_date: "2025-01-29",
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
							id: "TODO",
						},
					],
					observability: {
						enabled: true,
					},
				}),
				"src/index.ts": dedent`
				import { createRouter } from "@actor-core/cloudflare-workers";
				import { Hono } from "hono";
				${actorImports}

				// Create your Hono app inside the fetch handler
				const app = new Hono();

				// Add your custom routes
				app.get("/", (c) => c.text("Welcome to my app!"));
				app.get("/hello", (c) => c.text("Hello, world!"));

				const { router: actorRouter, ActorHandler } = createRouter({
					actors: { ${actorList} },
					// IMPORTANT: Must specify the same basePath where your router is mounted
					basePath: "/my-path"
				});

				// Mount the ActorCore router at /my-path
				app.route("/my-path", actorRouter);
				
				export { app as default, ActorHandler };
                `,
				// TODO: Make this only generate on the counter example
				"tests/client.ts": dedent`
				import { Client } from "actor-core/client";
				import Counter from "../../../src/counter";

				async function main() {
					// Note the custom path that matches the router.basePath
					const client = new Client("http://localhost:8787/my-path");

					const counter = await client.get<Counter>({ name: "counter" });

					counter.on("newCount", (count) => console.log("Event:", count));

					const out = await counter.increment(5);
					console.log("RPC:", out);

					await counter.disconnect();
				}

				main().catch(console.error);
				`,
			},
		};
	},
	bun: (input) => {
		input.packageJson.name += "-bun";
		input.packageJson.devDependencies = {
			"@actor-core/bun": "workspace:*",
			...input.packageJson.devDependencies,
		};
		input.packageJson.scripts = {
			dev: "bun run --hot src/index.ts",
			start: "bun run src/index.ts",
			...input.packageJson.scripts,
		};

		const { actorImports, actorList } = buildActorImports(input);

		const files = {
			"package.json": stringifyJson(input.packageJson),
			"src/index.ts": dedent`
			import { createHandler } from "@actor-core/bun"
			${actorImports}

			export default createHandler({
				actors: { ${actorList} }
			});
			`,
		};

		return {
			files,
		};
	},
	nodejs: (input) => {
		input.packageJson.name += "-nodejs";
		input.packageJson.devDependencies = {
			"@actor-core/nodejs": "workspace:*",
			tsx: "^4.19.2",
			...input.packageJson.devDependencies,
		};
		input.packageJson.scripts = {
			start: "npx tsx src/index.ts",
			dev: "npx tsx watch src/index.ts",
			...input.packageJson.scripts,
		};

		const { actorImports, actorList } = buildActorImports(input);

		const files = {
			"package.json": stringifyJson(input.packageJson),
			"src/index.ts": dedent`
			import { serve } from "@actor-core/nodejs"
			${actorImports}

			serve({
				actors: { ${actorList} },
			});
			`,
		};

		return {
			files,
		};
	},
	"nodejs-redis": (input) => {
		input.packageJson.name += "-nodejs-redis";
		input.packageJson.devDependencies = {
			"@actor-core/nodejs": "workspace:*",
			"@actor-core/redis": "workspace:*",
			tsx: "^4.19.2",
			...input.packageJson.devDependencies,
		};
		input.packageJson.scripts = {
			start: "npx tsx src/index.ts",
			dev: "npx tsx watch src/index.ts",
			...input.packageJson.scripts,
		};

		const { actorImports, actorList } = buildActorImports(input);

		const files = {
			"package.json": stringifyJson(input.packageJson),
			"src/index.ts": dedent`
			import { serve } from "@actor-core/nodejs"
			import { RedisManagerDriver } from "@actor-core/redis/manager";
			import { RedisActorDriver } from "@actor-core/redis/actor";
			import { RedisCoordinateDriver } from "@actor-core/redis/coordinate";
			import Redis from "ioredis";
			${actorImports}

			const redis = new Redis();

			serve({
				actors: { ${actorList} },
				topology: "coordinate",
				drivers: {
					manager: new RedisManagerDriver(redis),
					actor: new RedisActorDriver(redis),
					coordinate: new RedisCoordinateDriver(redis),
				},
			});
			`,
		};

		return {
			files,
		};
	},
	"nodejs-custom-path": (input) => {
		input.packageJson.name += "-nodejs-custom-path";
		input.packageJson.devDependencies = {
			"@actor-core/nodejs": "workspace:*",
			"@actor-core/memory": "workspace:*",
			hono: "^4.0.0",
			"@hono/node-server": "^1.0.0",
			tsx: "^4.19.2",
			...input.packageJson.devDependencies,
		};
		input.packageJson.scripts = {
			start: "npx tsx src/index.ts",
			dev: "npx tsx watch src/index.ts",
			...input.packageJson.scripts,
		};

		const { actorImports, actorList } = buildActorImports(input);

		const files = {
			"package.json": stringifyJson(input.packageJson),
			"src/index.ts": dedent`
			import { serve } from "@hono/node-server";
			import { Hono } from "hono";
			import { createRouter } from "@actor-core/nodejs";
			import { MemoryManagerDriver } from "@actor-core/memory/manager";
			import { MemoryActorDriver } from "@actor-core/memory/actor";
			${actorImports}

			// Create your Hono app
			const app = new Hono();

			// Add your custom routes
			app.get("/", (c) => c.text("Welcome to my app!"));
			app.get("/hello", (c) => c.text("Hello, world!"));

			// Create the ActorCore router and get the injectWebSocket function
			const { router: actorRouter, injectWebSocket } = createRouter({
				actors: { ${actorList} },
				topology: "standalone",
				drivers: {
					manager: new MemoryManagerDriver(),
					actor: new MemoryActorDriver(),
				},
				// Custom base path for ActorCore
				basePath: "/my-path"
			});

			// Mount the ActorCore router at /my-path
			app.route("/my-path", actorRouter);

			// Create server with the combined app
			const server = serve({
				fetch: app.fetch,
				port: 8787,
			});

			// IMPORTANT: Inject the websocket handler into the server
			injectWebSocket(server);

			console.log("Server running at http://localhost:8787");
			console.log("ActorCore mounted at http://localhost:8787/my-path");
			`,
			// TODO: Make this only generate on the counter example
			"tests/client.ts": dedent`
			import { Client } from "actor-core/client";
			import Counter from "../../../src/counter";

			async function main() {
				// Note the custom path that matches the router.basePath
				const client = new Client("http://localhost:8787/my-path");

				const counter = await client.get<Counter>({ name: "counter" });

				counter.on("newCount", (count) => console.log("Event:", count));

				const out = await counter.increment(5);
				console.log("RPC:", out);

				await counter.disconnect();
			}

			main().catch(console.error);
			`,
		};

		return {
			files,
		};
	},
};

function buildActorImports(input: PlatformInput): {
	actorImports: string;
	actorList: string;
} {
	const actorImports = Object.entries(input.packageJson.example.actors)
		.map(
			([k, v]) =>
				`import ${k.replace("-", "_")} from "../../../${v.replace(/\.ts$/, "")}";`,
		)
		.join("\n");
	const actorList = Object.entries(input.packageJson.example.actors)
		.map(([k, _v]) => `"${k}": ${k.replace("-", "_")}`)
		.join("\n");
	return { actorImports, actorList };
}

async function main() {
	const examplesDir = path.join(__dirname, "..", "examples");
	const examples = fs.readdirSync(examplesDir);

	for (const example of examples) {
		const examplePath = path.join(examplesDir, example);
		const packageJsonPath = path.join(examplePath, "package.json");

		// Skip if not a directory or doesn't have package.json
		if (
			!fs.statSync(examplePath).isDirectory() ||
			!fs.existsSync(packageJsonPath)
		) {
			continue;
		}

		// Ignore generated platforms
		const platformsPath = path.join(examplePath, "platforms");
		if (fs.existsSync(platformsPath)) {
			fs.rmSync(platformsPath, { recursive: true });
		}
		fs.mkdirSync(platformsPath, { recursive: true });
		fs.writeFileSync(path.join(platformsPath, ".gitignore"), "*");

		// Read the example's package.json
		const packageJson = PackageJsonSchema.parse(
			JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")),
		);

		// Read example config
		const exampleConfig = packageJson.example;
		if (exampleConfig.platforms.includes("*"))
			exampleConfig.platforms = Object.keys(PLATFORMS);

		console.log(
			`Templating ${example} (${exampleConfig.platforms.join(", ")})`,
		);

		// Create platform-specific folders and files
		for (const platform of exampleConfig.platforms) {
			const platformDir = path.join(platformsPath, platform);
			const srcDir = path.join(platformDir, "src");

			// Create directories
			fs.mkdirSync(platformDir, { recursive: true });
			fs.mkdirSync(srcDir, { recursive: true });

			// Call platform config function and write files
			const platformConfig = PLATFORMS[platform];
			const output = platformConfig({
				path: examplePath,
				packageJson: structuredClone(packageJson),
			});

			// Write all generated files
			for (const [filePath, content] of Object.entries(output.files)) {
				const fullPath = path.join(platformDir, filePath);
				// Ensure directory exists for the file
				fs.mkdirSync(path.dirname(fullPath), { recursive: true });
				fs.writeFileSync(fullPath, content);
			}

			// Write default tsconfig.json
			fs.writeFileSync(
				path.join(platformDir, "tsconfig.json"),
				fs.readFileSync(path.join(examplePath, "tsconfig.json")),
			);
		}
	}
}

main().catch(console.error);
