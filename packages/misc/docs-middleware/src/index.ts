//const PROTO = "https:"
// const HOST = "rivet-c4d395ab-02-13-docs_new_landing_page.mintlify.app";
// const PORT = "443"

const PROTO = "http:";
const HOST = "localhost";
const PORT = "3000";

const STYLES = `
.inline-icon {
    display: inline-block;
    width: 1em;
    height: 1em;
    vertical-align: middle;
    object-fit: cover;
    margin-left: 0.2em;
}

.no-break {
    white-space: nowrap;
}

.button {
	color: white;
	padding: 0.75rem 1.25rem;
	border-radius: 9999px;
	margin-right: 0.75rem;
}
`;

const INTRO_STYLES = `
#header {
    display: none;
}
`;

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

		// Fix redirect locations
		if (response.status >= 300 && response.status < 400) {
			const location = response.headers.get("Location");
			if (location) {
				const newUrl = new URL(location, url);
				newUrl.hostname = originalHost;

				// Override location
				const newHeaders = new Headers(response.headers);
				newHeaders.set("Location", newUrl.toString());

				return new Response(response.body, {
					status: response.status,
					statusText: response.statusText,
					headers: newHeaders,
				});
			}
		}

		// Inject styles
		const rewriter = new HTMLRewriter();
		rewriter.on("head", {
			element(element) {
				element.append(`<style>${STYLES}</style>`, { html: true });
			},
		});
		if (url.pathname === "/" || url.pathname === "/introduction") {
			rewriter.on("head", {
				element(element) {
					element.append(`<style>${INTRO_STYLES}</style>`, { html: true });
				},
			});
		}

		return rewriter.transform(response);
	},
} satisfies ExportedHandler<Env>;
