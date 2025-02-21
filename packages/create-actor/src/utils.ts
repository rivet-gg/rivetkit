import fs from "node:fs";

export function stringifyJson(input: unknown): string {
	return JSON.stringify(input, null, 2);
}

export const DEFAULT_TS_CONFIG = `{
    "compilerOptions": {
      /* Visit https://aka.ms/tsconfig.json to read more about this file */
  
      /* Set the JavaScript language version for emitted JavaScript and include compatible library declarations. */
      "target": "esnext",
      /* Specify a set of bundled library declaration files that describe the target runtime environment. */
      "lib": ["esnext"],
      /* Specify what JSX code is generated. */
      "jsx": "react-jsx",
  
      /* Specify what module code is generated. */
      "module": "esnext",
      /* Specify how TypeScript looks up a file from a given module specifier. */
      "moduleResolution": "bundler",
      /* Specify type package names to be included without being referenced in a source file. */
      "types": ["@cloudflare/workers-types"],
      /* Enable importing .json files */
      "resolveJsonModule": true,
  
      /* Allow JavaScript files to be a part of your program. Use the \`checkJS\` option to get errors from these files. */
      "allowJs": true,
      /* Enable error reporting in type-checked JavaScript files. */
      "checkJs": false,
  
      /* Disable emitting files from a compilation. */
      "noEmit": true,
  
      /* Ensure that each file can be safely transpiled without relying on other imports. */
      "isolatedModules": true,
      /* Allow 'import x from y' when a module doesn't have a default export. */
      "allowSyntheticDefaultImports": true,
      /* Ensure that casing is correct in imports. */
      "forceConsistentCasingInFileNames": true,
  
      /* Enable all strict type-checking options. */
      "strict": true,
  
      /* Skip type checking all .d.ts files. */
      "skipLibCheck": true
    },
    "include": ["**/*.ts"]
  }
  `;

interface PkgInfo {
	name: string;
	version: string;
}

export function pkgFromUserAgent(
	userAgent: string | undefined,
): PkgInfo | undefined {
	if (!userAgent) return undefined;
	const pkgSpec = userAgent.split(" ")[0];
	const pkgSpecArr = pkgSpec.split("/");
	return {
		name: pkgSpecArr[0],
		version: pkgSpecArr[1],
	};
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
