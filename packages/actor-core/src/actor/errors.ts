export const INTERNAL_ERROR_CODE = "internal_error";
export const INTERNAL_ERROR_DESCRIPTION =
	"Internal error. Read the actor logs for more details.";
export type InternalErrorMetadata = {};

export const USER_ERROR_CODE = "user_error";

interface ActorErrorOptions extends ErrorOptions {
	/** Error data can safely be serialized in a response to the client. */
	public?: boolean;
	/** Metadata associated with this error. This will be sent to clients. */
	metadata?: unknown;
}

export class ActorError extends Error {
	__type = "ActorError";

	public public: boolean;
	public metadata?: unknown;
	public statusCode: number = 500;

	public static isActorError(error: unknown): error is ActorError {
		return (
			typeof error === "object" && (error as ActorError).__type === "ActorError"
		);
	}

	constructor(
		public readonly code: string,
		message: string,
		opts?: ActorErrorOptions,
	) {
		super(message, { cause: opts?.cause });
		this.public = opts?.public ?? false;
		this.metadata = opts?.metadata;

		// Set status code based on error type
		if (opts?.public) {
			this.statusCode = 400; // Bad request for public errors
		}
	}

	toString() {
		// Force stringify to return the message
		return this.message;
	}

	/**
	 * Serialize error for HTTP response
	 */
	serializeForHttp() {
		return {
			type: this.code,
			message: this.message,
			metadata: this.metadata,
		};
	}
}

export class InternalError extends ActorError {
	constructor(message: string) {
		super(INTERNAL_ERROR_CODE, message);
	}
}

export class Unreachable extends InternalError {
	constructor(x: never) {
		super(`Unreachable case: ${x}`);
	}
}

export class StateNotEnabled extends ActorError {
	constructor() {
		super(
			"state_not_enabled",
			"State not enabled. Must implement `createState` or `state` to use state.",
		);
	}
}

export class ConnStateNotEnabled extends ActorError {
	constructor() {
		super(
			"conn_state_not_enabled",
			"Connection state not enabled. Must implement `createConnectionState` or `connectionState` to use connection state.",
		);
	}
}

export class VarsNotEnabled extends ActorError {
	constructor() {
		super(
			"vars_not_enabled",
			"Variables not enabled. Must implement `createVars` or `vars` to use state.",
		);
	}
}

export class ActionTimedOut extends ActorError {
	constructor() {
		super("action_timed_out", "Action timed out.", { public: true });
	}
}

export class ActionNotFound extends ActorError {
	constructor() {
		super("action_not_found", "Action not found.", { public: true });
	}
}

export class InvalidEncoding extends ActorError {
	constructor(format?: string) {
		super("invalid_encoding", `Invalid encoding \`${format}\`.`, {
			public: true,
		});
	}
}

export class ConnNotFound extends ActorError {
	constructor(id?: string) {
		super("conn_not_found", `Connection not found for ID \`${id}\`.`, {
			public: true,
		});
	}
}

export class IncorrectConnToken extends ActorError {
	constructor() {
		super("incorrect_conn_token", "Incorrect connection token.", {
			public: true,
		});
	}
}

export class ConnParamsTooLong extends ActorError {
	constructor() {
		super("conn_params_too_long", "Connection parameters too long.", {
			public: true,
		});
	}
}

export class MalformedConnParams extends ActorError {
	constructor(cause: unknown) {
		super(
			"malformed_conn_params",
			`Malformed connection parameters: ${cause}`,
			{ public: true, cause },
		);
	}
}

export class MessageTooLong extends ActorError {
	constructor() {
		super("message_too_long", "Message too long.", { public: true });
	}
}

export class MalformedMessage extends ActorError {
	constructor(cause?: unknown) {
		super("malformed_message", `Malformed message: ${cause}`, {
			public: true,
			cause,
		});
	}
}

export interface InvalidStateTypeOptions {
	path?: unknown;
}

export class InvalidStateType extends ActorError {
	constructor(opts?: InvalidStateTypeOptions) {
		let msg = "";
		if (opts?.path) {
			msg += `Attempted to set invalid state at path \`${opts.path}\`.`;
		} else {
			msg += "Attempted to set invalid state.";
		}
		msg += " State must be JSON serializable.";
		super("invalid_state_type", msg);
	}
}

export class StateTooLarge extends ActorError {
	constructor() {
		super("state_too_large", "State too large.");
	}
}

export class Unsupported extends ActorError {
	constructor(feature: string) {
		super("unsupported", `Unsupported feature: ${feature}`);
	}
}

/**
 * Options for the UserError class.
 */
export interface UserErrorOptions extends ErrorOptions {
	/**
	 * Machine readable code for this error. Useful for catching different types of errors in try-catch.
	 */
	code?: string;

	/**
	 * Additional metadata related to the error. Useful for understanding context about the error.
	 */
	metadata?: unknown;
}

/** Error that can be safely returned to the user. */
export class UserError extends ActorError {
	/**
	 * Constructs a new UserError instance.
	 *
	 * @param message - The error message to be displayed.
	 * @param opts - Optional parameters for the error, including a machine-readable code and additional metadata.
	 */
	constructor(message: string, opts?: UserErrorOptions) {
		super(opts?.code ?? USER_ERROR_CODE, message, {
			public: true,
			metadata: opts?.metadata,
		});
	}
}

export class InvalidQueryJSON extends ActorError {
	constructor(error?: unknown) {
		super("invalid_query_json", `Invalid query JSON: ${error}`, {
			public: true,
			cause: error,
		});
	}
}

export class InvalidRequest extends ActorError {
	constructor(error?: unknown) {
		super("invalid_request", `Invalid request: ${error}`, {
			public: true,
			cause: error,
		});
	}
}

export class ActorNotFound extends ActorError {
	constructor(identifier?: string) {
		super(
			"actor_not_found",
			identifier ? `Actor not found: ${identifier}` : "Actor not found",
			{ public: true },
		);
	}
}

export class ActorAlreadyExists extends ActorError {
	constructor(name: string, key: string[]) {
		super(
			"actor_already_exists",
			`Actor already exists with name "${name}" and key ${JSON.stringify(key)}`,
			{ public: true },
		);
	}
}

export class ProxyError extends ActorError {
	constructor(operation: string, error?: unknown) {
		super("proxy_error", `Error proxying ${operation}: ${error}`, {
			public: true,
			cause: error,
		});
	}
}

export class InvalidActionRequest extends ActorError {
	constructor(message: string) {
		super("invalid_action_request", message, { public: true });
	}
}

export class InvalidParams extends ActorError {
	constructor(message: string) {
		super("invalid_params", message, { public: true });
	}
}
