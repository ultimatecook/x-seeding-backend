export async function loader({ request }) {
  const url = new URL(request.url);
  const q   = url.searchParams.get('q')?.trim().replace(/^@/, '');

  if (!q || q.length < 2) {
    return Response.json({ users: [] });
  }

  // Try multiple endpoints in order — Instagram rate-limits aggressively
  const attempts = [
    // Endpoint 1: topsearch (most data but often blocked)
    async () => {
      const res = await fetch(
        `https://www.instagram.com/web/search/topsearch/?query=${encodeURIComponent(q)}&count=5`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'x-ig-app-id': '936619743392459',
            'Referer': 'https://www.instagram.com/',
          },
          signal: AbortSignal.timeout(4000),
        }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const raw  = data.users || [];
      return raw.map(u => ({
        username:   u.user.username,
        fullName:   u.user.full_name || '',
        profilePic: u.user.profile_pic_url || null,
        followers:  u.user.follower_count  || null,
      }));
    },

    // Endpoint 2: web profile info (exact username lookup)
    async () => {
      const res = await fetch(
        `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(q)}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
            'x-ig-app-id': '936619743392459',
          },
          signal: AbortSignal.timeout(4000),
        }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const u    = data?.data?.user;
      if (!u) throw new Error('no user');
      return [{
        username:   u.username,
        fullName:   u.full_name || '',
        profilePic: u.profile_pic_url || null,
        followers:  u.edge_followed_by?.count || null,
      }];
    },
  ];

  for (const attempt of attempts) {
    try {
      const users = await attempt();
      if (users.length > 0) {
        // Prefer exact username match, fall back to first result
        const exact = users.find(u => u.username.toLowerCase() === q.toLowerCase());
        const result = exact ? [exact, ...users.filter(u => u !== exact)] : users;
        return Response.json({ users: result.slice(0, 3) });
      }
    } catch (err) {
      console.warn(`Instagram lookup attempt failed: ${err.message}`);
      // Try next endpoint
    }
  }

  // All endpoints failed — return empty with a soft error so UI doesn't block user
  return Response.json({ users: [], rateLimited: true });
}
