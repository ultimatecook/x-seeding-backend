export async function loader({ request }) {
  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim();

  if (!q || q.length < 2) {
    return Response.json({ users: [] });
  }

  try {
    const igUrl = `https://www.instagram.com/web/search/topsearch/?query=${encodeURIComponent(q)}&count=3`;
    const res = await fetch(igUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'x-ig-app-id': '936619743392459',
        'Referer': 'https://www.instagram.com/',
        'Origin': 'https://www.instagram.com',
      },
    });

    if (!res.ok) {
      return Response.json({ users: [], error: 'Instagram unavailable' });
    }

    const data = await res.json();
    const users = (data.users || []).slice(0, 3).map(u => ({
      username: u.user.username,
      fullName: u.user.full_name || '',
      profilePic: u.user.profile_pic_url || null,
      followers: u.user.follower_count || null,
    }));

    return Response.json({ users });
  } catch (err) {
    console.error('Instagram search error:', err);
    return Response.json({ users: [], error: 'Search unavailable' });
  }
}
