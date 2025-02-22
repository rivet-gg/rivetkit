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
