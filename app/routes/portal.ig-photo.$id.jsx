/**
 * GET /portal/ig-photo/:id
 *
 * Serves a stored Instagram profile photo for an influencer.
 *
 * If the photo is already in Influencer.profilePicData, it is returned directly
 * (no external call). This is the fast path for new influencers.
 *
 * If no photo is stored yet (existing influencers), the route tries to fetch one
 * from Instagram's search API by handle, stores the bytes, and returns them.
 * On any failure it returns 404 so InstagramAvatar falls back to initials.
 *
 * No portal auth check — these are public Instagram profile photos, and auth
 * redirects break <img> tags (the browser follows the redirect, gets HTML, and
 * fires onError, causing the component to show initials even for logged-in users).
 */
import prisma from '../db.server';

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':     'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
};

// In-memory lock so concurrent requests for the same id don't all fire fetches
const inflight = new Set();

async function fetchPhotoBytes(url) {
  const res = await fetch(url, {
    headers: FETCH_HEADERS,
    redirect: 'follow',
    signal:   AbortSignal.timeout(6000),
  });
  if (!res.ok) return null;
  const ct  = res.headers.get('content-type') || '';
  if (!ct.startsWith('image/')) return null;
  const buf = await res.arrayBuffer();
  if (buf.byteLength < 2000) return null;  // placeholder icon
  return Buffer.from(buf);
}

async function fetchAndStorePhoto(inf) {
  const handle = (inf.handle || '').replace(/^@/, '');
  if (!handle) return null;

  // Try Instagram's search endpoints in order
  const attempts = [
    async () => {
      const res = await fetch(
        `https://www.instagram.com/web/search/topsearch/?query=${encodeURIComponent(handle)}&count=3`,
        {
          headers: {
            ...FETCH_HEADERS,
            'x-ig-app-id': '936619743392459',
            'Referer':     'https://www.instagram.com/',
          },
          signal: AbortSignal.timeout(5000),
        }
      );
      if (!res.ok) throw new Error(`topsearch ${res.status}`);
      const data  = await res.json();
      const match = (data.users || []).find(u =>
        u.user?.username?.toLowerCase() === handle.toLowerCase()
      ) || data.users?.[0];
      const picUrl = match?.user?.profile_pic_url;
      if (!picUrl) throw new Error('no pic url');
      return picUrl;
    },
    async () => {
      const res = await fetch(
        `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`,
        {
          headers: {
            'User-Agent':  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
            'x-ig-app-id': '936619743392459',
          },
          signal: AbortSignal.timeout(5000),
        }
      );
      if (!res.ok) throw new Error(`profile_info ${res.status}`);
      const data   = await res.json();
      const picUrl = data?.data?.user?.profile_pic_url;
      if (!picUrl) throw new Error('no pic url');
      return picUrl;
    },
  ];

  for (const attempt of attempts) {
    try {
      const picUrl = await attempt();
      const bytes  = await fetchPhotoBytes(picUrl);
      if (bytes) {
        // Store for future requests
        await prisma.influencer.update({
          where: { id: inf.id },
          data:  { profilePicData: bytes },
        });
        return bytes;
      }
    } catch {
      // try next
    }
  }
  return null;
}

export async function loader({ params }) {
  const id = parseInt(params.id);
  if (!id || isNaN(id)) return new Response(null, { status: 404 });

  const inf = await prisma.influencer.findUnique({
    where:  { id },
    select: { id: true, handle: true, profilePicData: true },
  });
  if (!inf) return new Response(null, { status: 404 });

  // Fast path: photo already stored
  if (inf.profilePicData && inf.profilePicData.length > 100) {
    return new Response(inf.profilePicData, {
      status: 200,
      headers: {
        'Content-Type':  'image/jpeg',
        'Cache-Control': 'public, max-age=604800, immutable',
      },
    });
  }

  // Slow path: try to fetch and store the photo now
  if (inflight.has(id)) {
    // Another request is already fetching — return 404 for now, browser will retry
    return new Response(null, { status: 404 });
  }
  inflight.add(id);
  try {
    const bytes = await fetchAndStorePhoto(inf);
    if (bytes) {
      return new Response(bytes, {
        status: 200,
        headers: {
          'Content-Type':  'image/jpeg',
          'Cache-Control': 'public, max-age=604800, immutable',
        },
      });
    }
  } finally {
    inflight.delete(id);
  }

  return new Response(null, { status: 404 });
}
