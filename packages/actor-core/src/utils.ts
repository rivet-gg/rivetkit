export { assertUnreachable } from "./common/utils";
import pkgJson from "../package.json" with { type: "json" };

export const VERSION = pkgJson.version;

let _userAgent: string | undefined = undefined;

export function httpUserAgent(): string {
	// Return cached value if already initialized
	if (_userAgent !== undefined) {
		return _userAgent;
	}

	// Library
	let userAgent = `ActorCore/${VERSION}`;

	// Navigator
	const navigatorObj = typeof navigator !== "undefined" ? navigator : undefined;
	if (navigatorObj?.userAgent) userAgent += ` ${navigatorObj.userAgent}`;

	_userAgent = userAgent;

	return userAgent;
}
