import { authenticate } from '../shopify.server';

/**
 * GDPR: Customer data request
 * A customer has asked what data the app holds about them.
 * Zeedy stores influencer records keyed by handle/email — we log the request
 * and respond 200. In a production app you would email the customer a data report.
 */
export async function action({ request }) {
  const { shop, payload } = await authenticate.webhook(request);
  console.log(`[GDPR] customers/data_request for shop ${shop}`, payload?.customer?.email);
  // No personal data is shared with third parties; respond 200 to acknowledge.
  return new Response(null, { status: 200 });
}
