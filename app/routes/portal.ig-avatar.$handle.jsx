/**
 * Server-side Instagram avatar proxy.
 *
 * GET /portal/ig-avatar/:handle
 *
 * Asks unavatar.io for the Instagram profile photo and proxies it back.
 * We no longer check CDN domains (unavatar now serves images through its own
 * CDN cache, so the final URL may stay on unavatar.io even for real photos).
 * Instead we filter by body size: unavatar's "no photo" placeholder is a tiny
 * SVG/PNG (~1–2 KB), while real profile photos are always above ~8 KB.
 */

// Minimum byte size a real profile photo must exceed.
// unavatar's fallback icon is ~1–2 KB; real Instagram photos are 10–150 KB.
const MIN_REAL_PHOTO_BYTES = 5_000;

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

      const ct = res.headers.get('content-type') || '';
      if (!ct.startsWith('image/')) continue;

      const buf = await res.arrayBuffer();

      // Reject tiny placeholders — unavatar's fallback icon is always < 5 KB.
      if (buf.byteLength < MIN_REAL_PHOTO_BYTES) continue;

      return new Response(buf, {
        status: 200,
        headers: {
          'Content-Type':  ct,
          'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        },
      });
    } catch {
      // try next source
    }
  }

  return new Response(null, { status: 404 });
}
