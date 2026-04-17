import { authenticate } from '../shopify.server';
import prisma from '../db.server';

/**
 * GDPR: Shop redact
 * The merchant has uninstalled the app and 48 hours have passed.
 * Shopify asks us to delete all data for the shop.
 * We delete all influencer, seeding, campaign, portal user, and session data.
 */
export async function action({ request }) {
  const { shop } = await authenticate.webhook(request);

  console.log(`[GDPR] shop/redact for shop ${shop}`);

  try {
    // Delete in dependency order (children before parents)
    await prisma.seeding.deleteMany({ where: { shop } });
    await prisma.influencer.deleteMany({ where: { shop } });
    await prisma.campaign.deleteMany({ where: { shop } });
    await prisma.portalUser.deleteMany({ where: { shop } });
    await prisma.session.deleteMany({ where: { shop } });
    await prisma.auditLog.deleteMany({ where: { shop } });
  } catch (e) {
    console.error(`[GDPR] shop/redact error for ${shop}:`, e.message);
    // Still return 200 — Shopify will retry on 5xx
  }

  return new Response(null, { status: 200 });
}
