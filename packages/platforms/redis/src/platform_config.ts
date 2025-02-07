import { Hono, Handler, Context as HonoContext } from "hono";

/** Config specific to how this driver should work with the given platform. */
export interface PlatformConfig {
	// This is dynamic since NodeJS requires a reference to the app to initialize WebSockets
	getUpgradeWebSocket?: (app: Hono) => (createEvents: (c: HonoContext) => any) => Handler;
}
