import path from "node:path";
import { bundleRequire } from "bundle-require";
import z from "zod";
import type { ActorCoreApp } from "actor-core";

const ActorCoreConfig = z.object({
	// biome-ignore lint/suspicious/noExplicitAny: we need to use any here because we don't know the type of the app
	app: z.custom<ActorCoreApp<any>>(),
	cwd: z.string(),
});

export async function loadConfig(
	_cwd: string,
	appPath: string,
): Promise<{ path: string; data: z.infer<typeof ActorCoreConfig> } | null> {
	try {
		const config = await bundleRequire({
			filepath: appPath,
		});
		return {
			path: appPath,
			data: config.mod.default || config.mod,
		};
	} catch (error) {
		throw { isBundleError: true, path: appPath, details: error };
	}
}

export async function requireConfig(cwd: string, appPath: string) {
	const config = await loadConfig(cwd, appPath);
	if (!config || !config.data) {
		throw { isNotFoundError: true, cwd, appPath };
	}
	return config;
}

export async function validateConfig(cwd: string, appPath: string) {
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
