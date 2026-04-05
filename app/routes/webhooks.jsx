import { authenticate } from '../shopify.server';
import prisma from '../db.server';

export async function action({ request }) {
  const { topic, payload } = await authenticate.webhook(request);

  switch (topic) {
    // Influencer completed checkout → draft order becomes a real order
    case 'DRAFT_ORDERS_UPDATE': {
      const data = typeof payload === 'string' ? JSON.parse(payload) : payload;

      // Only act when the draft order has been completed (linked to a real order)
      if (data.status === 'completed' && data.id) {
        const draftGid = `gid://shopify/DraftOrder/${data.id}`;

        await prisma.seeding.updateMany({
          where: { shopifyDraftOrderId: draftGid, status: 'Pending' },
          data: {
            status: 'Ordered',
            // Store the real Shopify order name if available
            shopifyOrderName: data.order_id ? `#${data.order_id}` : undefined,
          },
        });
      }
      break;
    }

    // Fulfillment center shipped the order
    case 'FULFILLMENTS_CREATE': {
      const data = typeof payload === 'string' ? JSON.parse(payload) : payload;

      if (data.order_id) {
        // Match by shopifyOrderName since we store it as "#<order_id>"
        await prisma.seeding.updateMany({
          where: {
            shopifyOrderName: `#${data.order_id}`,
            status: 'Ordered',
          },
          data: { status: 'Shipped' },
        });
      }
      break;
    }

    default:
      break;
  }

  return new Response(null, { status: 200 });
}
