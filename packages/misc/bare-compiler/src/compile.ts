import { type Config, transform } from "@bare-ts/tools";
import * as fs from "fs/promises";
import * as path from "path";

export interface CompileOptions {
	schemaPath: string;
	outputPath: string;
	config?: Partial<Config>;
}

export async function compileSchema(options: CompileOptions): Promise<void> {
	const { schemaPath, outputPath, config = {} } = options;

	const schema = await fs.readFile(schemaPath, "utf-8");
	const outputDir = path.dirname(outputPath);

	await fs.mkdir(outputDir, { recursive: true });

	const defaultConfig: Partial<Config> = {
		pedantic: true,
		generator: "ts",
		...config,
	};

	const result = transform(schema, defaultConfig);

	await fs.writeFile(outputPath, result);
}

export { type Config, transform } from "@bare-ts/tools";
