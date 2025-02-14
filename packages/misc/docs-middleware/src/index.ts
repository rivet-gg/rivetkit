const PROTO = "https:"
const HOST = "rivet-c4d395ab.mintlify.app";
const PORT = "443"

// const PROTO = "http:";
// const HOST = "localhost";
// const PORT = "3000";

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

[data-page="/"] #header, [data-page="/introduction"] #header {
    display: none;
}
`;

const SCRIPT = `
<script>
	// Inject script to set page attribute so we can style pages according to the current page
	//
	// See also HTMLRewriter
	document.addEventListener('DOMContentLoaded', function() {
		// Add attribute on change
		function onPathChange() {
			console.log("Path changed to:", window.location.pathname);
			document.documentElement.setAttribute('data-page', window.location.pathname);
		}
		onPathChange();

		// Swizzle state changes
		const originalPushState = history.pushState;
		const originalReplaceState = history.replaceState;

		history.pushState = function (...args) {
			originalPushState.apply(this, args);
			onPathChange();
		};

		history.replaceState = function (...args) {
			originalReplaceState.apply(this, args);
			onPathChange();
		};

		// Add events
		window.addEventListener('popstate', updateDataPage);
		window.addEventListener('pushstate', updateDataPage);
		window.addEventListener('replacestate', updateDataPage);
	});
</script>
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

		// Inject styles & scripts
		const rewriter = new HTMLRewriter();
		rewriter.on("head", {
			element(element) {
				element.append(`<style>${STYLES}</style>`, { html: true });
				element.append(SCRIPT, { html: true });
			},
		});

		// Expose data attribute
		rewriter.on("html", {
			element(element) {
				element.setAttribute("data-page", url.pathname);
			},
		});

		return rewriter.transform(response);
	},
} satisfies ExportedHandler<Env>;
