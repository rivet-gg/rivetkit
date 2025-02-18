import { BaseConfig } from "actor-core/driver-helpers";

export interface Config extends BaseConfig {
	server?: {
		hostname?: string;
		port?: number;
	};
}
