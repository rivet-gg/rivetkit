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
				export default createManagerHandler();
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
			import { createHandler } from "@actor-core/rivet"
			import Actor from "../../../${script}";
			export default createHandler(Actor);
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
			"tsx": "^4.19.2",
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
				actors: { ${actorList} }
			});
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
		.map(([k, v]) => `import ${k.replace("-", "_")} from "../../../${v}";`)
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
