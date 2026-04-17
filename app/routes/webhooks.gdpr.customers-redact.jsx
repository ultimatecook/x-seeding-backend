import { authenticate } from '../shopify.server';
import prisma from '../db.server';

/**
 * GDPR: Customer redact
 * Shopify asks us to delete personal data for a specific customer.
 * We redact email and name from any influencer record matching the customer's email.
 */
export async function action({ request }) {
  const { shop, payload } = await authenticate.webhook(request);
  const customerEmail = payload?.customer?.email;

  console.log(`[GDPR] customers/redact for shop ${shop}`, customerEmail);

  if (customerEmail) {
    // Null out PII fields — keep the record so seeding history isn't broken
    await prisma.influencer.updateMany({
      where: { shop, email: customerEmail },
      data:  { email: null, name: '[redacted]' },
    });
  }

  return new Response(null, { status: 200 });
}
