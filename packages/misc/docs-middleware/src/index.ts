//const PROTO = "https:"
//const HOST = "rivet-c4d395ab.mintlify.app";
//const PORT = "443"

 const PROTO = "http:";
 const HOST = "localhost";
 const PORT = "3000";

const STYLES = `
.landing-root {
  max-width: 72rem;
  margin-left: auto;
  margin-right: auto;
  padding-top: 10rem;
  padding-bottom: 3rem;
  padding-left: 1.5rem;
  padding-right: 1.5rem;
}

@media (min-width: 1024px) {
  .landing-root {
    padding-top: 5rem;
    padding-bottom: 3rem;
    padding-left: 6rem;
    padding-right: 6rem;
  }
}

.inline-icon {
    display: inline-block;
    width: 1em;
    height: 1em;
    vertical-align: middle;
    object-fit: contain;
    margin-left: 0.2em;
}

.platform-link {
    color: white;
    font-weight: 500;
}

.no-break {
    white-space: nowrap;
}

.button {
	color: white;
	padding: 0.5rem 1.25rem;
	border-radius: 10px;
    display: block;
    white-space: nowrap;
}

.button-orange {
    background: #ff4f00;
}

.buttons-container {
    display: flex;
    margin-top: 2rem;
    margin-bottom: 1.5rem;
    flex-wrap: wrap;
    gap: 0.75rem;
}

.copy-command-container {
    margin-top: 0.5rem;
    font-size: 0.875rem;
    color: hsl(0, 0%, 60%);
    display: flex;
    align-items: center;
    cursor: copy;
    position: relative;
}

/* Copy command styled as a button */
.copy-command-button {
    margin: 0;
    margin-right: 0.75rem;
    font-size: 1rem;
    cursor: pointer;
    display: flex;
    align-items: center;
}

.copy-command-button .copy-command-text {
    background: hsl(0, 0%, 15%);
    border-radius: 10px;
    padding: 0.5rem 1.25rem;
    color: white;
}

.copy-command-button .icon-container {
    margin-left: 0.75rem;
}

.copy-command-button .copy-icon svg,
.copy-command-button .check-icon svg {
    color: hsl(0, 0%, 40%);
}

.icon-container {
    position: relative;
    width: 1em;
    height: 1em;
    margin-left: 0.1em;
    margin-top: -1px; /* Subtle adjustment to align with text */
    vertical-align: middle;
}

.copy-command-container .icon-container {
	opacity: 0;
    transition: opacity 0.2s ease;
}

.copy-command-container:hover .icon-container {
	opacity: 1;
}

.copy-command-container .icon-container .copy-icon,
.copy-command-container .icon-container .check-icon {
    position: absolute;
	left: 50%;
	top: 50%;
	transform: translate(-50%, -50%);
    transition: opacity 0.2s ease;
}

.copy-command-container .icon-container .copy-icon {
    opacity: 1;
}

.copy-command-container .icon-container .check-icon {
    opacity: 0;
}

/* Class for showing the check icon */
.copy-command-container .icon-container.copied .copy-icon {
    opacity: 0;
}

.copy-command-container .icon-container.copied .check-icon {
    opacity: 1;
}

.copy-command-text {
    position: relative;
    padding: 0.25rem 0.5rem;
    font-family: monospace;
    display: inline-block;
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
	
	// Global function for copying commands
	window.copyCommand = function(element) {
		// Get the container if passed element isn't the container itself
		const container = element.classList.contains('copy-command-container') ? 
			element : element.closest('.copy-command-container');
			
		if (!container) return;
		
		// Find the command text
		const commandTextElement = container.querySelector('.copy-command-text');
		if (!commandTextElement) return;
		
		const commandText = commandTextElement.textContent.trim();
		
		// Strip the leading $ if present
		const textToCopy = commandText.startsWith('$') ? 
			commandText.substring(1).trim() : commandText;
		
		// Copy to clipboard
		navigator.clipboard.writeText(textToCopy);
		
		// Show the check icon temporarily
		const iconContainer = container.querySelector('.icon-container');
		if (!iconContainer) return;
		
		// Toggle copied class to show the check icon
		iconContainer.classList.add('copied');
		
		// Reset after animation completes
		setTimeout(() => {
			iconContainer.classList.remove('copied');
		}, 1000);
	}
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
