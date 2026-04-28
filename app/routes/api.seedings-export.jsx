import prisma from '../db.server';
import { authenticate } from '../shopify.server';
import { handlePreflight } from '../utils/security.server';

export async function loader({ request }) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  await authenticate.admin(request);

  const url      = new URL(request.url);
  const status   = url.searchParams.get('status')   || 'all';
  const campaign = url.searchParams.get('campaign') || '';
  const country  = url.searchParams.get('country')  || '';
  const q        = url.searchParams.get('q')        || '';

  const where = {};
  if (status !== 'all') where.status     = status;
  if (campaign)         where.campaignId = parseInt(campaign);

  const influencerWhere = {};
  if (country) influencerWhere.country = country;
  if (q) {
    influencerWhere.OR = [
      { handle: { contains: q, mode: 'insensitive' } },
      { name:   { contains: q, mode: 'insensitive' } },
    ];
  }
  if (Object.keys(influencerWhere).length > 0) where.influencer = influencerWhere;

  const seedings = await prisma.seeding.findMany({
    where,
    include: { influencer: true, products: true, campaign: { select: { title: true } } },
    orderBy: { createdAt: 'desc' },
  });

  const escape = (v) => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const headers = ['Date', 'Influencer Handle', 'Influencer Name', 'Country', 'Campaign', 'Products', 'Units', 'Total Cost (€)', 'Status', 'Tracking Number', 'Order'];
  const rows = seedings.map(s => [
    new Date(s.createdAt).toLocaleDateString('en-GB'),
    s.influencer.handle,
    s.influencer.name,
    s.influencer.country || '',
    s.campaign?.title || '',
    s.products.map(p => p.productName).join('; '),
    s.products.length,
    s.totalCost.toFixed(2),
    s.status,
    s.trackingNumber || '',
    s.shopifyOrderName || '',
  ]);

  const csv = [headers, ...rows].map(row => row.map(escape).join(',')).join('\n');

  const today = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      'Content-Type':        'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="seedings-${today}.csv"`,
    },
  });
}
