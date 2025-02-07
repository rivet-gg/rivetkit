import type { BaseConfig } from "actor-core/platform";

export interface Config extends BaseConfig {
	actors: Record<string, any>;
}
