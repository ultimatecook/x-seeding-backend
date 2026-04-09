/**
 * Simple sliding-window rate limiter.
 * Works per-instance (Vercel warm lambdas) — good enough to catch abuse.
 * Worst case on cold start: window resets. That's acceptable.
 */

const store = new Map(); // key -> { count, windowStart }

/**
 * @param {string} key       - unique key (e.g. IP + route)
 * @param {number} limit     - max requests allowed in the window
 * @param {number} windowMs  - window size in milliseconds
 * @returns {{ allowed: boolean, remaining: number, retryAfterMs: number }}
 */
export function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now - entry.windowStart > windowMs) {
    // New window
    store.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: limit - 1, retryAfterMs: 0 };
  }

  if (entry.count >= limit) {
    const retryAfterMs = windowMs - (now - entry.windowStart);
    return { allowed: false, remaining: 0, retryAfterMs };
  }

  entry.count += 1;
  return { allowed: true, remaining: limit - entry.count, retryAfterMs: 0 };
}

/**
 * Extract best available IP from request headers (works on Vercel).
 */
export function getClientIp(request) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

/**
 * Returns a 429 Response with Retry-After header.
 */
export function tooManyRequests(retryAfterMs) {
  const seconds = Math.ceil(retryAfterMs / 1000);
  return new Response(
    JSON.stringify({ error: 'Too many requests. Please slow down.' }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(seconds),
      },
    }
  );
}
