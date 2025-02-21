import "./instrument";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import k from "kleur";
import prompts from "prompts";
import { rimraf } from "rimraf";

import { VERSION, getExamples } from "./macros" with { type: "macro" };
import { PLATFORM_NAMES, resolvePlatformSpecificOptions } from "./platforms";
import { DEFAULT_TS_CONFIG, isSafeToWrite, pkgFromUserAgent } from "./utils";

const EXAMPLES = await getExamples();

// MARK: Parse arguments
const { values, positionals } = parseArgs({
	args: process.argv.slice(2),
	options: {
		help: {
			type: "boolean",
			short: "h",
		},
		template: {
			type: "string",
			short: "t",
		},
		overwrite: {
			type: "boolean",
			short: "o",
		},
		platform: {
			type: "string",
			short: "p",
		},
		workspace: {
			type: "boolean",
		},
	},
	allowPositionals: true,
});

console.log(`🎭 ${k.red().bold("Create Actor")} ${k.gray(`v${VERSION}`)}`);
console.log();

if (values.help) {
	console.log(`${k.bold("create-actor")} [folder] [options]

${k.underline("Positionals:")}
  folder    Target folder to create the actor in

${k.underline("Options:")}
  -h, --help        Show this help message
  -t, --template    Template to use
  -p, --platform    Platform to use
  -o, --overwrite   Overwrite existing files
  --workspace       Use workspace version of actor-core
`);
	process.exit(0);
}

let { template, platform, overwrite, workspace } = values;
let [folderName] = positionals;

// MARK: Target folder question
if (!folderName) {
	const response = await prompts(
		{
			type: "text",
			name: "name",
			message: "Enter a folder name",
			validate: (value) => (value ? true : "Folder name cannot be empty"),
		},
		{ onCancel: () => process.exit(1) },
	);
	folderName = response.name;
}

const targetDir = path.isAbsolute(folderName)
	? folderName
	: path.join(process.cwd(), folderName);

if (!isSafeToWrite(targetDir) && !overwrite) {
	console.log(
		k.red(
			`✖ Specified directory ${k.underline(
				`${targetDir}`,
			)} is not empty. Please choose an empty directory or use --overwrite flag.`,
		),
	);
	process.exit(1);
}

// MARK: Template question
if (!template) {
	const response = await prompts(
		{
			type: "select",
			name: "template",
			message: "Choose template",
			choices: Object.values(EXAMPLES).map((example) => ({
				title: example.name,
				value: example.slug,
			})),
		},
		{ onCancel: () => process.exit(1) },
	);
	template = response.template;
}
assert(template !== undefined, "Template must be defined");

// MARK: Platform question
if (!platform) {
	const response = await prompts(
		{
			type: "select",
			name: "platform",
			message: "Choose platform",
			choices: EXAMPLES[template].supports.map((platform) => ({
				title: PLATFORM_NAMES[platform],
				value: platform,
			})),
		},
		{ onCancel: () => process.exit(1) },
	);
	platform = response.platform;
}
assert(platform !== undefined, "Platform must be defined");

// MARK: Copy template files
console.log(
	`🔨 Creating new actor in ${k.underline(path.relative(process.cwd(), targetDir))}...`,
);
if (overwrite) {
	await rimraf(targetDir);
} else if (!fs.existsSync(targetDir)) {
	fs.mkdirSync(targetDir, { recursive: true });
}

const { files } = resolvePlatformSpecificOptions(platform, {
	files: EXAMPLES[template].files,
	version: workspace ? "workspace:*" : VERSION,
});

for (const [name, contents] of Object.entries(files)) {
	const filePath = path.join(targetDir, name);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, contents, "utf8");
}

fs.writeFileSync(path.join(targetDir, ".gitignore"), "node_modules\n");
fs.writeFileSync(path.join(targetDir, "tsconfig.json"), DEFAULT_TS_CONFIG);

// MARK: Run instructions
const pkgInfo = pkgFromUserAgent(process.env.npm_config_user_agent);
const pkgManager = pkgInfo?.name || "npm";
const runDevCmd = pkgManager === "yarn" ? "yarn dev" : `${pkgManager} run dev`;

console.log(`
✨ Done. To get started:

   cd ${path.relative(process.cwd(), folderName)}
   ${pkgManager} install
   ${runDevCmd}
   
Read more: https://actorcore.org/platforms/${platform}
Happy hacking! 🚀
`);

// for happy sentry
export default {};
