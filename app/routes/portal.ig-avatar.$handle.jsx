/**
 * ⚠️  This route is no longer used by InstagramAvatar.
 *
 * unavatar.io blocks server-side fetches with a 403 (X-Proxy-Error: blocked-by-allowlist).
 * InstagramAvatar now loads https://unavatar.io/instagram/:handle directly in the browser,
 * which is not subject to the server IP restriction.
 *
 * Kept as a stub so any cached references don't 404.
 */
export async function loader() {
  return new Response(null, { status: 404 });
}
