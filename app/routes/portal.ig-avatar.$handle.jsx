/**
 * Server-side Instagram avatar proxy.
 *
 * GET /portal/ig-avatar/:handle
 *
 * Asks unavatar.io for the Instagram profile photo and follows the redirect.
 * If the final URL is on Instagram's CDN (cdninstagram.com / fbcdn.net), we
 * proxy the image back so the browser can display it.
 * If unavatar returns its own fallback icon (the Instagram logo), the redirect
 * stays on unavatar.io — we return 404 so the client shows initials instead.
 */
export async function loader({ params }) {
  const clean = (params.handle || '').replace(/^@/, '');
  if (!clean) return new Response(null, { status: 404 });

  const sources = [
    `https://unavatar.io/instagram/${encodeURIComponent(clean)}`,
    `https://unavatar.io/${encodeURIComponent(clean)}`,
  ];

  for (const src of sources) {
    try {
      const res = await fetch(src, {
        redirect: 'follow',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        },
      });

      if (!res.ok) continue;

      const finalUrl = res.url || src;

      // Only trust the image if it landed on Instagram's actual CDN.
      // When unavatar can't find a profile photo it serves its own
      // fallback icon — the redirect stays on unavatar.io, not Instagram's CDN.
      const isInstagramCDN =
        finalUrl.includes('cdninstagram.com') ||
        finalUrl.includes('fbcdn.net') ||
        finalUrl.includes('scontent');

      if (!isInstagramCDN) continue;

      const buf  = await res.arrayBuffer();
      const ct   = res.headers.get('content-type') || 'image/jpeg';

      return new Response(buf, {
        status: 200,
        headers: {
          'Content-Type':  ct,
          'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
          'X-Avatar-Src':  finalUrl,
        },
      });
    } catch {
      // try next source
    }
  }

  return new Response(null, { status: 404 });
}
