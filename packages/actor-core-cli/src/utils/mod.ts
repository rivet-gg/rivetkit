export * from "./config";
export * from "./pkg";
export * from "./fs";
export * from "./platforms";

export function withResolvers<T>() {
	let resolve: (value: T) => void;
	let reject: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	// biome-ignore lint/style/noNonNullAssertion: <explanation>
	return { promise, resolve: resolve!, reject: reject! };
}
