import dedent from "dedent";
import type { PackageJson } from "pkg-types";
import { removeExt, stringifyJson } from "./utils";
import path from "node:path";

interface PlatformOutput {
	files: Record<string, string>;
}

interface PlatformOptions extends ExampleMetadata {
	version: string;
	files: Record<string, string>;
	pkgJson: PackageJson;
}

type PlatformConfigFn = (platformOpts: PlatformOptions) => PlatformOutput;

const PLATFORMS: Record<string, PlatformConfigFn> = {
	supabase: ({ files, version, pkgJson, actorImports, actorMap }) => {
		files["package.json"] = stringifyJson({
			...pkgJson,
			devDependencies: {
				"@actor-core/supabase": version,
				...pkgJson.devDependencies,
			},
		});

		files["src/index.ts"] = dedent`
            import { createHandler } from "@actor-core/supabase"
            ${actorImports("src/index.ts")}

            export default createHandler({
                actors: { ${actorMap} }
            });
        `;

		return { files };
	},
	vercel: ({ files, version, pkgJson, actorImports, actorMap }) => {
		files["package.json"] = stringifyJson({
			...pkgJson,
			scripts: {
				...pkgJson.scripts,
				dev: "next dev",
				build: "next build",
				start: "next start",
			},
			devDependencies: {
				"@actor-core/vercel": version,
				next: "^14.0.0",
				...pkgJson.devDependencies,
			},
		});

		files["src/api/actor/route.ts"] = dedent`
            import { createHandler } from "@actor-core/vercel"
            ${actorImports("./src/api/actor/route.ts")}

            const handler = createHandler({
                actors: { ${actorMap} }
            });

            export const GET = handler.GET;
            export const POST = handler.POST;
            export const PUT = handler.PUT;
            export const DELETE = handler.DELETE;
            export const PATCH = handler.PATCH;
            export const HEAD = handler.HEAD;
            export const OPTIONS = handler.OPTIONS;
        `;

		return { files };
	},
	rivet: ({ files, pkgJson, actors, version }) => {
		files["package.json"] = stringifyJson({
			...pkgJson,
			devDependencies: {
				"@actor-core/rivet": version,
				...pkgJson.devDependencies,
			},
		});

		files["src/_manager.ts"] = dedent`
            import { createManagerHandler } from "@actor-core/rivet";
            export default createManagerHandler();
        `;

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

		for (const { name, relativeImport } of Object.values(actors)) {
			files[`src/${name}-handler.ts`] = dedent`
			import { createHandler } from "@actor-core/rivet"
			import Actor from "${relativeImport(`src/${name}.ts`)}";
			export default createHandler(Actor);
			`;
			rivetJson.builds[name] = {
				script: `${name}-handler.ts`,
				access: "public",
			};
		}

		files["rivet.json"] = stringifyJson(rivetJson);

		return {
			files,
		};
	},
	"cloudflare-workers": ({
		files,
		pkgJson,
		version,
		actorImports,
		actorMap,
	}) => {
		files["package.json"] = stringifyJson({
			...pkgJson,
			devDependencies: {
				"@actor-core/cloudflare-workers": version,
				wrangler: "^3.101.0",
				"@cloudflare/workers-types": "^4.20250129.0",
				...pkgJson.devDependencies,
			},
			scripts: {
				deploy: "wrangler deploy",
				dev: "wrangler dev",
				start: "wrangler dev",
				"cf-typegen": "wrangler types",
				...pkgJson.scripts,
			},
		});

		files["wrangler.toml"] = stringifyJson({
			name: "actor-core",
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
		});
		files["src/index.ts"] = dedent`
				import { createHandler } from "@actor-core/cloudflare-workers";
				${actorImports("./src/index.ts")}

				const { handler, ActorHandler } = createHandler({
					actors: { ${actorMap} }
				});

				export { handler as default, ActorHandler };
                `;

		return {
			files,
		};
	},
	deno: ({ files, pkgJson, version, actorImports, actorMap }) => {
		files["package.json"] = stringifyJson({
			...pkgJson,
			devDependencies: {
				"@actor-core/deno": version,
				...pkgJson.devDependencies,
			},
			scripts: {
				start: "deno run --allow-net src/index.ts",
				dev: "deno run --allow-net --watch src/index.ts",
				...pkgJson.scripts,
			},
		});

		files["src/index.ts"] = dedent`
            import { serve } from "@actor-core/deno"
            ${actorImports("./src/index.ts")}

            serve({
                actors: { ${actorMap} }
            });
        `;

		return { files };
	},
	bun: ({ files, pkgJson, version, actorImports, actorMap }) => {
		files["package.json"] = stringifyJson({
			...pkgJson,
			devDependencies: {
				"@actor-core/bun": version,
				...pkgJson.devDependencies,
			},
			scripts: {
				dev: "bun run --hot src/index.ts",
				start: "bun run src/index.ts",
				...pkgJson.scripts,
			},
		});

		files["src/index.ts"] = dedent`
            import { createHandler } from "@actor-core/bun"
            ${actorImports("./src/index.ts")}

            export default createHandler({
                actors: { ${actorMap} }
            });
        `;

		return { files };
	},
	nodejs: ({ files, pkgJson, version, actorImports, actorMap }) => {
		files["package.json"] = stringifyJson({
			...pkgJson,
			devDependencies: {
				"@actor-core/nodejs": version,
				...pkgJson.devDependencies,
			},
			scripts: {
				start: "npx tsx src/index.ts",
				dev: "npx tsx watch src/index.ts",
				...pkgJson.scripts,
			},
		});

		files["src/index.ts"] = dedent`
            import { serve } from "@actor-core/nodejs"
            ${actorImports("./src/index.ts")}

            serve({
                actors: { ${actorMap} }
            });
        `;
		return { files };
	},
};

export const PLATFORM_SLUGS = Object.keys(PLATFORMS);
export const PLATFORM_NAMES: Record<keyof typeof PLATFORMS, string> = {
	supabase: "Supabase",
	vercel: "Vercel",
	rivet: "Rivet",
	"cloudflare-workers": "Cloudflare Workers",
	deno: "Deno",
	bun: "Bun",
	nodejs: "Node.js",
};

export function resolvePlatformSpecificOptions(
	platform: keyof typeof PLATFORMS,
	opts: Pick<PlatformOptions, "files" | "version">,
): PlatformOutput {
	const platformConfig = PLATFORMS[platform];
	if (!platformConfig) {
		throw new Error(`Platform ${platform} not supported`);
	}

	const pkgJson = JSON.parse(opts.files["package.json"]);

	pkgJson.devDependencies["actor-core"] = opts.version;

	const configOpts = {
		...opts,
		pkgJson,
		...buildExampleMetadata(pkgJson),
	};

	const newOpts = {
		...opts,
		...platformConfig(configOpts),
	};

	// remove example
	const newPkg = JSON.parse(newOpts.files["package.json"]);
	newPkg.example = undefined;

	newOpts.files["package.json"] = stringifyJson(newPkg);

	return newOpts;
}

interface ExampleMetadata {
	actorImports: (path?: string) => string;
	actorMap: string;
	actors: {
		name: string;
		path: string;
		relativeImport: (base: string) => string;
	}[];
}

function buildExampleMetadata(pkgJson: PackageJson): ExampleMetadata {
	const actorImports = (base = ".") =>
		Object.entries<string>(pkgJson.example.actors)
			.map(([k, actorPath]) => {
				const importPath = path.relative(path.dirname(base), actorPath);
				return `import ${k.replace("-", "_")} from "./${removeExt(importPath)}";`;
			})
			.join("\n");
	const actorMap = Object.entries(pkgJson.example.actors)
		.map(([k, _v]) => `"${k}": ${k.replace("-", "_")}`)
		.join("\n");

	const actors = Object.entries<string>(pkgJson.example.actors).map(
		([name, actorPath]) => {
			const importPath = path.relative(path.dirname(actorPath), actorPath);
			return {
				name,
				path: actorPath,
				relativeImport: (p: string) => `./${removeExt(importPath)}`,
			};
		},
	);
	return { actorImports, actorMap, actors };
}
