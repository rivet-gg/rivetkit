import fs from "node:fs";

export function stringifyJson(input: unknown): string {
	return JSON.stringify(input, null, 2);
}

export function isEmpty(path: string) {
	const files = fs.readdirSync(path);
	return files.length === 0 || (files.length === 1 && files[0] === ".git");
}

export function isSafeToWrite(path: string) {
	return !fs.existsSync(path) || isEmpty(path);
}

export function removeExt(path: string) {
	return path.substring(0, path.lastIndexOf("."));
}
