/**
 * ⚠️  This route is no longer used.
 *
 * Profile photos are now fetched once at influencer-creation time and stored in
 * Influencer.profilePicData (BYTEA). They are served via /portal/ig-photo/:id.
 *
 * Kept as a stub so any bookmarked/cached URLs don't 404.
 */
export async function loader() {
  return new Response(null, { status: 404 });
}
