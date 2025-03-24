import fs from "node:fs";
import path from "node:path";
import { bundleRequire } from "bundle-require";
import JoyCon from "joycon";
import z from "zod";
import type { ActorCoreApp } from "actor-core";

const ActorCoreConfig = z.object({
	// biome-ignore lint/suspicious/noExplicitAny: we need to use any here because we don't know the type of the app
	app: z.custom<ActorCoreApp<any>>(),
	cwd: z.string(),
});

export async function loadConfig(
	cwd: string,
): Promise<{ path: string; data: z.infer<typeof ActorCoreConfig> } | null> {
	const configJoycon = new JoyCon();

	const configPath = await configJoycon.resolve({
		files: [
			"src/index.ts",
			"src/index.tsx",
			"src/index..mts",
			"src/index.js",
			"src/index.cjs",
			"src/index.mjs",
		],
		cwd,
		stopDir: path.parse(cwd).root,
	});

	if (configPath) {
		try {
			const config = await bundleRequire({
				filepath: configPath,
			});
			return {
				path: configPath,
				data: config.mod.default || config.mod,
			};
		} catch (error) {
			throw { isBundleError: true, details: error };
		}
	}

	return null;
}

export async function requireConfig(cwd: string) {
	const config = await loadConfig(cwd);
	if (!config || !config.data) {
		throw { isNotFoundError: true };
	}
	return config;
}

export async function validateConfig(cwd: string) {
	const config = await requireConfig(cwd);
	return await ActorCoreConfig.parseAsync({
		...config.data,
		cwd: path.dirname(config.path),
	});
}

export const isNotFoundError = (
	error: unknown,
): error is { isNotFoundError: true } => {
	return z.object({ isNotFoundError: z.literal(true) }).safeParse(error)
		.success;
};

export const isBundleError = (
	error: unknown,
): error is { isBundleError: true; details: unknown } => {
	return z
		.object({ isBundleError: z.literal(true), details: z.any() })
		.safeParse(error).success;
};
