/**
 * billing.server.js
 * Shopify Billing API integration — trial + recurring subscription.
 *
 * Env vars:
 *   BILLING_TRIAL_DAYS   default 14
 *   BILLING_PLAN_PRICE   default 29  (USD/month)
 *   BETA_MODE            set to "true" to grant free access to all shops (beta period)
 */

// When BETA_MODE=true, all shops get full access regardless of billing status.
export const BETA_MODE = process.env.BETA_MODE === 'true';

import prisma from '../db.server';

const TRIAL_DAYS = parseInt(process.env.BILLING_TRIAL_DAYS || '14', 10);
const PLAN_PRICE = parseFloat(process.env.BILLING_PLAN_PRICE || '29');
const PLAN_DISPLAY_NAME = 'Zeedy Basic';

// ── Core helpers ──────────────────────────────────────────────────────────────

/**
 * Get or create a ShopBilling record.
 * Safe to call on every request — only creates once.
 */
export async function getOrCreateBilling(shop) {
  const existing = await prisma.shopBilling.findUnique({ where: { shop } });
  if (existing) return existing;

  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  return prisma.shopBilling.create({
    data: { shop, planName: 'trial', planStatus: 'trial', trialEndsAt },
  });
}

/**
 * Sync trial → expired if the trial period has ended.
 * Returns the (possibly updated) billing record.
 */
export async function refreshBillingStatus(billing) {
  if (
    billing.planStatus === 'trial' &&
    new Date() > new Date(billing.trialEndsAt)
  ) {
    return prisma.shopBilling.update({
      where: { id: billing.id },
      data:  { planStatus: 'expired' },
    });
  }
  return billing;
}

/**
 * Returns true if the shop has full access (trial active or paid plan active).
 * During BETA_MODE, always returns true.
 */
export function hasActiveAccess(billing) {
  if (BETA_MODE) return true;
  if (!billing) return false;
  if (billing.planStatus === 'active' && billing.billingStatus === 'active') return true;
  if (billing.planStatus === 'trial' && new Date() < new Date(billing.trialEndsAt)) return true;
  return false;
}

/**
 * How many days remain in the trial (0 if expired/paid).
 */
export function trialDaysRemaining(billing) {
  if (billing.planStatus !== 'trial') return 0;
  const ms = new Date(billing.trialEndsAt) - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

// ── Shopify Billing API ───────────────────────────────────────────────────────

/**
 * Create a recurring app subscription via Shopify Admin GraphQL.
 * Returns { confirmationUrl, chargeId } on success, or throws.
 */
export async function createShopifySubscription(admin, returnUrl) {
  const isTest = process.env.NODE_ENV !== 'production';

  const response = await admin.graphql(
    `#graphql
    mutation AppSubscriptionCreate(
      $name: String!
      $lineItems: [AppSubscriptionLineItemInput!]!
      $returnUrl: URL!
      $test: Boolean
    ) {
      appSubscriptionCreate(
        name: $name
        lineItems: $lineItems
        returnUrl: $returnUrl
        test: $test
      ) {
        appSubscription { id status }
        confirmationUrl
        userErrors { field message }
      }
    }`,
    {
      variables: {
        name: PLAN_DISPLAY_NAME,
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price:    { amount: PLAN_PRICE, currencyCode: 'USD' },
                interval: 'EVERY_30_DAYS',
              },
            },
          },
        ],
        returnUrl,
        test: isTest,
      },
    }
  );

  const { data } = await response.json();
  const result = data?.appSubscriptionCreate;

  if (result?.userErrors?.length) {
    throw new Error(result.userErrors.map(e => e.message).join(', '));
  }

  return {
    confirmationUrl: result.confirmationUrl,
    chargeId:        result.appSubscription?.id,
  };
}

/**
 * Query Shopify to verify a subscription status.
 * Returns the subscription node or null.
 */
export async function verifyShopifySubscription(admin, chargeId) {
  const response = await admin.graphql(
    `#graphql
    query GetSubscription($id: ID!) {
      node(id: $id) {
        ... on AppSubscription {
          id
          status
          currentPeriodEnd
        }
      }
    }`,
    { variables: { id: chargeId } }
  );

  const { data } = await response.json();
  return data?.node ?? null;
}

/**
 * Mark billing as active after Shopify confirms the subscription.
 */
export async function activateBilling(shop, chargeId) {
  return prisma.shopBilling.upsert({
    where:  { shop },
    update: {
      planName:        'basic',
      planStatus:      'active',
      billingStatus:   'active',
      shopifyChargeId: chargeId,
    },
    create: {
      shop,
      planName:        'basic',
      planStatus:      'active',
      billingStatus:   'active',
      shopifyChargeId: chargeId,
      trialEndsAt:     new Date(), // already ended
    },
  });
}

/**
 * Mark billing as cancelled (e.g. on uninstall or subscription webhook).
 */
export async function cancelBilling(shop) {
  const existing = await prisma.shopBilling.findUnique({ where: { shop } });
  if (!existing) return;
  return prisma.shopBilling.update({
    where: { shop },
    data:  { billingStatus: 'cancelled', planStatus: 'expired' },
  });
}

/**
 * Delete billing record entirely (used on app uninstall).
 */
export async function deleteBilling(shop) {
  try {
    await prisma.shopBilling.delete({ where: { shop } });
  } catch (_) {
    // Record may not exist — that's fine
  }
}

// ── UI helpers ────────────────────────────────────────────────────────────────

export const PLAN_PRICE_USD = PLAN_PRICE;
export const PLAN_DISPLAY = PLAN_DISPLAY_NAME;
export const PLAN_TRIAL_DAYS = TRIAL_DAYS;
