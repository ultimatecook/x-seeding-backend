/**
 * /app/billing/callback
 * Handles the return redirect from Shopify's billing approval page.
 * Verifies the subscription and activates the billing record.
 */
import { redirect, useRouteError } from 'react-router';
import { authenticate } from '../shopify.server';
import { boundary } from '@shopify/shopify-app-react-router/server';
import {
  verifyShopifySubscription,
  activateBilling,
} from '../utils/billing.server';
import prisma from '../db.server';

export async function loader({ request }) {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  // Look up the pending charge ID we stored when creating the subscription
  const billing = await prisma.shopBilling.findUnique({ where: { shop } });

  if (!billing?.shopifyChargeId) {
    console.error('[billing/callback] no pending chargeId for shop:', shop);
    return redirect('/app/billing?error=missing_charge');
  }

  try {
    const sub = await verifyShopifySubscription(admin, billing.shopifyChargeId);

    if (sub?.status === 'ACTIVE') {
      await activateBilling(shop, billing.shopifyChargeId);
      return redirect('/app?activated=1');
    }

    // Subscription not active (declined, pending, etc.)
    console.warn('[billing/callback] subscription not active:', sub?.status);
    return redirect(`/app/billing?status=${sub?.status ?? 'unknown'}`);
  } catch (e) {
    console.error('[billing/callback] verification error:', e?.message);
    return redirect('/app/billing?error=verification_failed');
  }
}

export default function BillingCallback() {
  return <p>Verifying subscription…</p>;
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
