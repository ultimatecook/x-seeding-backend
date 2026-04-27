import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";

export const streamTimeout = 5000;

export default async function handleRequest(
  request,
  responseStatusCode,
  responseHeaders,
  reactRouterContext,
) {
  const url = new URL(request.url);
  const isAppRoute = url.pathname.startsWith('/app') || url.pathname.startsWith('/auth');

  // Portal routes are standalone (not embedded in Shopify iframe) — skip Shopify's
  // frame-ancestors CSP header which would block them from loading in a regular browser tab.
  if (isAppRoute) {
    addDocumentResponseHeaders(request, responseHeaders);
  }

  // Security headers for HTML responses.
  // X-Frame-Options is only set on non-/app routes; for /app routes the
  // Shopify library already sets a frame-ancestors CSP that takes precedence
  // in modern browsers and governs iframe embedding inside Shopify admin.
  if (!isAppRoute) {
    responseHeaders.set('X-Frame-Options', 'SAMEORIGIN');
  }
  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? "") ? "onAllReady" : "onShellReady";

  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={reactRouterContext} url={request.url} />,
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          console.error(error);
        },
      },
    );

    // Automatically timeout the React renderer after 6 seconds, which ensures
    // React has enough time to flush down the rejected boundary contents
    setTimeout(abort, streamTimeout + 1000);
  });
}
