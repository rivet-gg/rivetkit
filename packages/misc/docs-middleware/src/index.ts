import cspBuilder from "content-security-policy-builder";
import parseContentSecurityPolicy from "content-security-policy-parser";

const PROTO = "https:";
const HOST = "rivet-c4d395ab.mintlify.app";
const PORT = "443";
// const PROTO = "http:";
// const HOST = "localhost";
// const PORT = "3000";

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);
		const originalHost = url.hostname;

		url.protocol = PROTO;
		url.host = HOST;
		url.port = PORT;

		// Proxy request
		const proxyRequest = new Request(url.toString(), request);
		proxyRequest.headers.set("Host", HOST);
		const response = await fetch(proxyRequest).catch((err) => {
			throw err;
		});

		// Allow iframe access
		const newHeaders = new Headers(response.headers);

		const host =
			request.headers.get("Referer") || request.headers.get("Origin") || "";

		const csp = parseContentSecurityPolicy(
			response.headers.get("Content-Security-Policy") || "",
		);

		if (
			host.includes("hub.rivet.gg") ||
			host.includes("studio.rivet.gg") ||
			host.includes("rivet.gg") ||
			host.includes("rivet-studio.pages.dev")
		) {
			csp.set("frame-ancestors", [host]);
		}

		const newCsp = cspBuilder({
			directives: csp,
		});

		newHeaders.set("Content-Security-Policy", newCsp);

		// Fix redirect locations
		if (response.status >= 300 && response.status < 400) {
			const location = response.headers.get("Location");
			if (location) {
				const newUrl = new URL(location, url);
				newUrl.hostname = originalHost;

				// Override location
				newHeaders.set("Location", newUrl.toString());

				return new Response(response.body, {
					status: response.status,
					statusText: response.statusText,
					headers: newHeaders,
				});
			}
		}

		// Expose data attribute (CSS and JS are now included directly in the docs)
		const rewriter = new HTMLRewriter();
		rewriter.on("html", {
			element(element) {
				element.setAttribute("data-page", url.pathname);
			},
		});

		// Expose data attribute
		rewriter.on("html", {
			element(element) {
				element.setAttribute("data-page", url.pathname);
			},
		});

		const newResponse = rewriter.transform(response);
		return new Response(newResponse.body, {
			status: response.status,
			statusText: response.statusText,
			headers: newHeaders,
		});
	},
} satisfies ExportedHandler<Env>;
