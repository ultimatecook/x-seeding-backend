import { authenticate } from '../shopify.server';
import prisma from '../db.server';
import { handlePreflight } from '../utils/security.server';

/**
 * GET /api/influencer-sizes?influencerId=123
 * Returns saved sizes for an influencer
 */
export async function loader({ request }) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const influencerId = parseInt(url.searchParams.get('influencerId'));

  if (!influencerId) {
    return new Response(JSON.stringify({ error: 'influencerId required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Verify the influencer belongs to this shop
    const influencer = await prisma.influencer.findUnique({ where: { id: influencerId }, select: { shop: true } });
    if (!influencer || influencer.shop !== shop) {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const savedSizes = await prisma.influencerSavedSize.findMany({
      where: { influencerId },
    });

    // Convert to a category -> size map for easy lookup
    const sizeMap = {};
    savedSizes.forEach(ss => {
      sizeMap[ss.category] = ss.size;
    });

    return new Response(JSON.stringify({ sizeMap, savedSizes }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Error fetching influencer sizes:', err);
    return new Response(JSON.stringify({ error: 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * POST /api/influencer-sizes
 * Save or update size for a category
 * Body: { influencerId, category, size }
 */
export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  if (request.method !== 'POST' && request.method !== 'PUT') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const influencerId = parseInt(body.influencerId);
    const category     = String(body.category  || '').slice(0, 50);
    const size         = String(body.size       || '').slice(0, 20);

    if (!influencerId || !category || !size) {
      return new Response(
        JSON.stringify({ error: 'influencerId, category, and size required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify the influencer belongs to this shop
    const influencer = await prisma.influencer.findUnique({ where: { id: influencerId }, select: { shop: true } });
    if (!influencer || influencer.shop !== shop) {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const savedSize = await prisma.influencerSavedSize.upsert({
      where: { influencerId_category: { influencerId, category } },
      update: { size },
      create: { influencerId, category, size },
    });

    return new Response(JSON.stringify(savedSize), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Error saving influencer size:', err);
    return new Response(JSON.stringify({ error: 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
