/**
 * GET /portal/ig-photo/:id
 *
 * Serves the Instagram profile photo stored in the database for an influencer.
 * The bytes are fetched once at influencer-creation time from Instagram's CDN
 * (when the URL is fresh) and stored in the Influencer.profilePicData column.
 * No external service is called at display time.
 */
import prisma from '../db.server';
import { requirePortalUser } from '../utils/portal-auth.server';

export async function loader({ request, params }) {
  await requirePortalUser(request);

  const id = parseInt(params.id);
  if (!id) return new Response(null, { status: 404 });

  const inf = await prisma.influencer.findUnique({
    where:  { id },
    select: { profilePicData: true },
  });

  if (!inf?.profilePicData || inf.profilePicData.length < 100) {
    return new Response(null, { status: 404 });
  }

  return new Response(inf.profilePicData, {
    status: 200,
    headers: {
      'Content-Type':  'image/jpeg',
      'Cache-Control': 'public, max-age=604800, immutable', // 7 days — bytes don't change
    },
  });
}
