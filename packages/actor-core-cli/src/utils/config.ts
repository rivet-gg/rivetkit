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
	appPath?: string,
): Promise<{ path: string; data: z.infer<typeof ActorCoreConfig> } | null> {
	const configJoycon = new JoyCon();

	// Attempt to auto-resolve app path
	let resolvedAppPath: string;
	if (appPath) {
		resolvedAppPath = appPath;
	} else {
		// Auto-resolve app path
		const resolved = await configJoycon.resolve({
			files: [
				"src/app.ts",
				"src/app.tsx",
				"src/app.mts",
				"src/app.js",
				"src/app.cjs",
				"src/app.mjs",
			],
			cwd,
			stopDir: path.parse(cwd).root,
		});
		if (!resolved) return null;
		resolvedAppPath = resolved;
	}

	try {
		const config = await bundleRequire({
			filepath: resolvedAppPath,
		});
		return {
			path: resolvedAppPath,
			data: config.mod.default || config.mod,
		};
	} catch (error) {
		throw { isBundleError: true, path: resolvedAppPath, details: error };
	}
}

export async function requireConfig(cwd: string, appPath?: string) {
	const config = await loadConfig(cwd, appPath);
	if (!config || !config.data) {
		throw { isNotFoundError: true, cwd, appPath };
	}
	return config;
}

export async function validateConfig(cwd: string, appPath?: string) {
	const config = await requireConfig(cwd, appPath);
	return await ActorCoreConfig.parseAsync({
		...config.data,
		cwd: path.dirname(config.path),
	});
}

export const isNotFoundError = (
	error: unknown,
): error is { isNotFoundError: true; cwd: string; path?: string } => {
	return z
		.object({
			isNotFoundError: z.literal(true),
			cwd: z.string(),
			appPath: z.string().optional(),
		})
		.safeParse(error).success;
};

export const isBundleError = (
	error: unknown,
): error is { isBundleError: true; path: string; details: unknown } => {
	return z
		.object({
			isBundleError: z.literal(true),
			path: z.string(),
			details: z.any(),
		})
		.safeParse(error).success;
};
