/**
 * CORS and security header utilities.
 *
 * ALLOWED_ORIGINS: origins that may call /api/* endpoints cross-origin.
 * The Shopify-embedded app and portal are served from the same backend
 * (same-origin), so most callers never trigger CORS at all. This list
 * covers external callers like a separately-hosted frontend or monitoring.
 */
const ALLOWED_ORIGINS = new Set([
  'https://www.zeedy.xyz',
  'https://x-seeding-backend.vercel.app',
  'https://admin.shopify.com',
]);

/**
 * Returns true when the request is a CORS preflight.
 */
export function isCorsPreFlight(request) {
  return request.method === 'OPTIONS';
}

/**
 * Adds CORS headers to an existing Headers object if the request origin is
 * in the allow-list.  Call this before returning any Response from an API route.
 */
export function applyCors(request, headers) {
  const origin = request.headers.get('Origin');
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    headers.set('Access-Control-Max-Age', '86400');
    headers.set('Vary', 'Origin');
  }
  return headers;
}

/**
 * Returns a 204 preflight response, or null when the request is not a
 * preflight.  Use at the top of a loader/action:
 *
 *   const preflight = handlePreflight(request);
 *   if (preflight) return preflight;
 */
export function handlePreflight(request) {
  if (!isCorsPreFlight(request)) return null;
  const headers = new Headers();
  applyCors(request, headers);
  return new Response(null, { status: 204, headers });
}

/**
 * Wraps a Response (or plain object passed to Response.json) with CORS
 * headers.  Convenience helper for API routes.
 *
 *   return withCors(request, Response.json({ ok: true }));
 */
export function withCors(request, response) {
  const origin = request.headers.get('Origin');
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return response;
  const headers = new Headers(response.headers);
  applyCors(request, headers);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
