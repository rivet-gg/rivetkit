//const PROTO = "https:"
//const HOST = "rivet-c4d395ab.mintlify.app";
//const PORT = "443"

const PROTO = "http:";
const HOST = "localhost";
const PORT = "3000";

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

    // Expose data attribute (CSS and JS are now included directly in the docs)
    const rewriter = new HTMLRewriter();
    rewriter.on("html", {
      element(element) {
        element.setAttribute("data-page", url.pathname);
      },
    });

    return rewriter.transform(response);
  },
} satisfies ExportedHandler<Env>;
