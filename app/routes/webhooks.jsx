import { authenticate } from '../shopify.server';
import prisma from '../db.server';

export async function action({ request }) {
  const { topic, payload } = await authenticate.webhook(request);
  const data = typeof payload === 'string' ? JSON.parse(payload) : payload;

  switch (topic) {

    // ── Influencer completes checkout → draft becomes a real order ──────────
    case 'DRAFT_ORDERS_UPDATE': {
      if (data.status === 'completed' && data.id) {
        const draftGid = `gid://shopify/DraftOrder/${data.id}`;

        // Build a clean address string from the shipping_address payload field
        let shippingAddress = null;
        const sa = data.shipping_address;
        if (sa) {
          const parts = [
            sa.name || [sa.first_name, sa.last_name].filter(Boolean).join(' '),
            sa.address1,
            sa.address2,
            sa.city,
            sa.province,
            sa.zip,
            sa.country,
          ].filter(Boolean);
          if (parts.length > 0) shippingAddress = parts.join(', ');
        }

        // Extract customer name and email from the draft order payload
        const customerName  = data.customer
          ? [data.customer.first_name, data.customer.last_name].filter(Boolean).join(' ')
          : (sa ? (sa.name || [sa.first_name, sa.last_name].filter(Boolean).join(' ')) : null);
        const customerEmail = data.customer?.email || data.email || null;

        // Update the seeding record
        const updatedSeedings = await prisma.seeding.findMany({
          where: { shopifyDraftOrderId: draftGid, status: 'Pending' },
          select: { id: true, influencerId: true },
        });

        if (updatedSeedings.length > 0) {
          await prisma.seeding.updateMany({
            where: { shopifyDraftOrderId: draftGid, status: 'Pending' },
            data: {
              status:           'Ordered',
              shopifyOrderName: data.order_id ? `#${data.order_id}` : undefined,
              ...(shippingAddress ? { shippingAddress } : {}),
            },
          });

          // Backfill influencer name + email from checkout (only if not already set)
          const influencerId = updatedSeedings[0].influencerId;
          const influencer   = await prisma.influencer.findUnique({ where: { id: influencerId } });
          if (influencer) {
            const updates = {};
            // Only overwrite name if it's still the placeholder (same as handle)
            if (customerName && influencer.name === influencer.handle.replace(/^@/, '')) {
              updates.name = customerName;
            }
            if (customerEmail && !influencer.email) {
              updates.email = customerEmail;
            }
            if (Object.keys(updates).length > 0) {
              await prisma.influencer.update({ where: { id: influencerId }, data: updates });
            }
          }
        }
      }
      break;
    }

    // ── Fulfillment center creates a shipment → Shipped ──────────────────────
    case 'FULFILLMENTS_CREATE': {
      if (data.order_id) {
        await prisma.seeding.updateMany({
          where: { shopifyOrderName: `#${data.order_id}`, status: 'Ordered' },
          data: { status: 'Shipped' },
        });
      }
      break;
    }

    // ── Carrier confirms delivery → Delivered ────────────────────────────────
    case 'FULFILLMENTS_UPDATE': {
      if (data.order_id && data.shipment_status === 'delivered') {
        await prisma.seeding.updateMany({
          where: { shopifyOrderName: `#${data.order_id}`, status: 'Shipped' },
          data: { status: 'Delivered' },
        });
      }
      break;
    }

    default:
      break;
  }

  return new Response(null, { status: 200 });
}
