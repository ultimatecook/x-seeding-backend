/**
 * /app/billing
 * Billing management page inside the Shopify admin embedded app.
 * Shows current plan status and handles subscription creation.
 */
import { useEffect } from 'react';
import { useLoaderData, useActionData, Form, useRouteError } from 'react-router';
import { authenticate } from '../shopify.server';
import { boundary } from '@shopify/shopify-app-react-router/server';
import {
  getOrCreateBilling,
  refreshBillingStatus,
  hasActiveAccess,
  trialDaysRemaining,
  createShopifySubscription,
  PLAN_PRICE_USD,
  PLAN_DISPLAY,
  PLAN_TRIAL_DAYS,
  BETA_MODE,
} from '../utils/billing.server';

const APP_URL = process.env.SHOPIFY_APP_URL || 'https://www.zeedy.xyz';

const P = {
  accent:      '#7C6FF7',
  accentHover: '#6558E8',
  accentLight: '#EDE9FF',
  accentFaint: '#F4F2FF',
  border:      '#E5E3F0',
  bg:          '#F7F6FB',
  surface:     '#FFFFFF',
  text:        '#1A1523',
  textSub:     '#6B6880',
  textMuted:   '#A09CB8',
  shadow:      '0 1px 4px rgba(124,111,247,0.08), 0 4px 16px rgba(0,0,0,0.04)',
  green:       '#22C55E',
  greenBg:     '#DCFCE7',
  greenText:   '#166534',
  amber:       '#F59E0B',
  amberBg:     '#FFFBEB',
  amberText:   '#B45309',
  red:         '#EF4444',
  redBg:       '#FEF2F2',
  redText:     '#DC2626',
};

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const raw     = await getOrCreateBilling(shop);
  const billing = await refreshBillingStatus(raw);

  return {
    shop,
    billing: {
      planName:       billing.planName,
      planStatus:     billing.planStatus,
      billingStatus:  billing.billingStatus,
      trialEndsAt:    billing.trialEndsAt?.toISOString() ?? null,
      shopifyChargeId: billing.shopifyChargeId,
    },
    daysRemaining: trialDaysRemaining(billing),
    isActive:      hasActiveAccess(billing),
    planPrice:     PLAN_PRICE_USD,
    planDisplay:   PLAN_DISPLAY,
    trialDays:     PLAN_TRIAL_DAYS,
    betaMode:      BETA_MODE,
  };
}

export async function action({ request }) {
  const { session, admin } = await authenticate.admin(request);
  const shop      = session.shop;
  const returnUrl = `${APP_URL}/app/billing/callback`;

  try {
    const { confirmationUrl, chargeId } = await createShopifySubscription(admin, returnUrl);

    // Store the pending charge ID so we can verify it on callback
    const { default: prisma } = await import('../db.server');
    await prisma.shopBilling.update({
      where: { shop },
      data:  { shopifyChargeId: chargeId, billingStatus: 'pending' },
    });

    return { confirmationUrl };
  } catch (e) {
    console.error('[billing] createShopifySubscription error:', e?.message);
    return { error: e?.message || 'Failed to create subscription. Please try again.' };
  }
}

export default function BillingPage() {
  const { billing, daysRemaining, isActive, planPrice, planDisplay, trialDays, betaMode } = useLoaderData();
  const actionData = useActionData();

  // Top-level redirect for embedded app after getting confirmationUrl
  useEffect(() => {
    if (actionData?.confirmationUrl) {
      window.top.location.href = actionData.confirmationUrl;
    }
  }, [actionData?.confirmationUrl]);

  const isExpired = billing.planStatus === 'expired';
  const isPaid    = billing.planStatus === 'active' && billing.billingStatus === 'active';
  const isTrial   = billing.planStatus === 'trial';

  // ── Beta Mode UI ─────────────────────────────────────────────────────────────
  if (betaMode) {
    return (
      <div style={{
        maxWidth: '560px',
        margin: '0 auto',
        padding: '48px 24px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif',
      }}>
        <div style={{ marginBottom: '32px' }}>
          <img src="/namelogo.svg" alt="ZEEDY" style={{ height: '36px', width: 'auto', display: 'block' }} />
        </div>

        <h1 style={{ margin: '0 0 4px', fontSize: '24px', fontWeight: '800', color: P.text, letterSpacing: '-0.5px' }}>
          Plan &amp; Billing
        </h1>
        <p style={{ margin: '0 0 32px', fontSize: '14px', color: P.textSub }}>
          Manage your Zeedy subscription.
        </p>

        {/* Beta banner */}
        <div style={{
          backgroundColor: P.accentFaint, border: `1px solid ${P.accentLight}`,
          borderRadius: '16px', padding: '24px 28px', marginBottom: '20px',
          display: 'flex', alignItems: 'flex-start', gap: '16px',
        }}>
          <div style={{
            width: '40px', height: '40px', borderRadius: '10px', flexShrink: 0,
            background: 'linear-gradient(135deg, #7C6FF7 0%, #5B4CF0 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '18px',
          }}>🎁</div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <span style={{ fontSize: '16px', fontWeight: '800', color: P.text }}>Beta Access — Free</span>
              <span style={{
                fontSize: '10px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.6px',
                backgroundColor: P.accent, color: '#fff', borderRadius: '20px', padding: '2px 8px',
              }}>BETA</span>
            </div>
            <p style={{ margin: 0, fontSize: '13px', color: P.textSub, lineHeight: '1.5' }}>
              You have full access to all Zeedy features at no cost during our beta period.
              Paid plans are coming soon — you'll be notified before anything changes.
            </p>
          </div>
        </div>

        {/* Current plan card */}
        <div style={{
          backgroundColor: P.surface, border: `1px solid ${P.border}`,
          borderRadius: '16px', padding: '28px', boxShadow: P.shadow, marginBottom: '20px',
        }}>
          <div style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.8px', color: P.textMuted, marginBottom: '16px' }}>
            Current plan
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <span style={{ fontSize: '20px', fontWeight: '800', color: P.text }}>Free Beta</span>
            <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', backgroundColor: P.greenBg, color: P.greenText, borderRadius: '20px', padding: '2px 10px' }}>
              Active
            </span>
          </div>
          <p style={{ margin: 0, fontSize: '13px', color: P.textSub }}>
            Full access included · No credit card required
          </p>
        </div>

        {/* Upcoming paid plan preview */}
        <div style={{
          backgroundColor: P.surface, border: `1px solid ${P.border}`,
          borderRadius: '16px', padding: '28px', boxShadow: P.shadow, marginBottom: '20px',
          opacity: 0.7,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.8px', color: P.textMuted }}>
              {planDisplay}
            </div>
            <span style={{
              fontSize: '10px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.6px',
              backgroundColor: P.amberBg, color: P.amberText, borderRadius: '20px', padding: '2px 10px',
            }}>Coming Soon</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px', marginBottom: '20px' }}>
            <span style={{ fontSize: '36px', fontWeight: '900', color: P.text, letterSpacing: '-1px' }}>${planPrice}</span>
            <span style={{ fontSize: '14px', color: P.textSub }}>/month</span>
          </div>

          {[
            'Unlimited seedings, campaigns & influencers',
            'Discount code pool management',
            'Team access with roles',
            'Multi-location inventory sync',
            'Full portal access',
          ].map(f => (
            <div key={f} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <span style={{ color: P.green, fontSize: '14px', fontWeight: '700' }}>✓</span>
              <span style={{ fontSize: '13px', color: P.textSub }}>{f}</span>
            </div>
          ))}

          <div style={{
            marginTop: '24px', width: '100%', padding: '14px',
            background: P.border,
            color: P.textMuted, border: 'none', borderRadius: '10px',
            fontSize: '15px', fontWeight: '700', textAlign: 'center',
          }}>
            Paid plans coming soon
          </div>
        </div>
      </div>
    );
  }

  // ── Standard Billing UI ───────────────────────────────────────────────────────
  return (
    <div style={{
      maxWidth: '560px',
      margin: '0 auto',
      padding: '48px 24px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif',
    }}>
      <div style={{ marginBottom: '32px' }}>
        <img src="/namelogo.svg" alt="ZEEDY" style={{ height: '36px', width: 'auto', display: 'block' }} />
      </div>

      <h1 style={{ margin: '0 0 4px', fontSize: '24px', fontWeight: '800', color: P.text, letterSpacing: '-0.5px' }}>
        Plan &amp; Billing
      </h1>
      <p style={{ margin: '0 0 32px', fontSize: '14px', color: P.textSub }}>
        Manage your Zeedy subscription.
      </p>

      {/* Error */}
      {actionData?.error && (
        <div style={{
          padding: '12px 16px', backgroundColor: P.redBg, color: P.redText,
          border: `1px solid #FECACA`, borderRadius: '10px', fontSize: '13px',
          fontWeight: '600', marginBottom: '20px',
        }}>
          {actionData.error}
        </div>
      )}

      {/* Redirecting state */}
      {actionData?.confirmationUrl && (
        <div style={{
          padding: '12px 16px', backgroundColor: P.accentFaint, color: P.accent,
          border: `1px solid ${P.accentLight}`, borderRadius: '10px', fontSize: '13px',
          fontWeight: '600', marginBottom: '20px',
        }}>
          Redirecting to Shopify billing…
        </div>
      )}

      {/* Current status card */}
      <div style={{
        backgroundColor: P.surface, border: `1px solid ${P.border}`,
        borderRadius: '16px', padding: '28px', boxShadow: P.shadow, marginBottom: '20px',
      }}>
        <div style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.8px', color: P.textMuted, marginBottom: '16px' }}>
          Current plan
        </div>

        {isPaid && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <span style={{ fontSize: '20px', fontWeight: '800', color: P.text }}>{planDisplay}</span>
              <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', backgroundColor: P.greenBg, color: P.greenText, borderRadius: '20px', padding: '2px 10px' }}>
                Active
              </span>
            </div>
            <p style={{ margin: 0, fontSize: '13px', color: P.textSub }}>
              ${planPrice}/month · Billed via Shopify
            </p>
          </div>
        )}

        {isTrial && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <span style={{ fontSize: '20px', fontWeight: '800', color: P.text }}>Free Trial</span>
              <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', backgroundColor: P.amberBg, color: P.amberText, borderRadius: '20px', padding: '2px 10px' }}>
                {daysRemaining} day{daysRemaining !== 1 ? 's' : ''} left
              </span>
            </div>
            <p style={{ margin: 0, fontSize: '13px', color: P.textSub }}>
              {trialDays}-day free trial · Full access included
            </p>
          </div>
        )}

        {isExpired && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <span style={{ fontSize: '20px', fontWeight: '800', color: P.text }}>Trial Ended</span>
              <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', backgroundColor: P.redBg, color: P.redText, borderRadius: '20px', padding: '2px 10px' }}>
                Expired
              </span>
            </div>
            <p style={{ margin: 0, fontSize: '13px', color: P.textSub }}>
              Subscribe to restore full access to your data and features.
            </p>
          </div>
        )}
      </div>

      {/* Paid plan details */}
      {!isPaid && (
        <div style={{
          backgroundColor: P.surface, border: `1px solid ${P.border}`,
          borderRadius: '16px', padding: '28px', boxShadow: P.shadow, marginBottom: '20px',
        }}>
          <div style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.8px', color: P.textMuted, marginBottom: '16px' }}>
            {planDisplay}
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px', marginBottom: '20px' }}>
            <span style={{ fontSize: '36px', fontWeight: '900', color: P.text, letterSpacing: '-1px' }}>${planPrice}</span>
            <span style={{ fontSize: '14px', color: P.textSub }}>/month</span>
          </div>

          {[
            'Unlimited seedings, campaigns & influencers',
            'Discount code pool management',
            'Team access with roles',
            'Multi-location inventory sync',
            'Full portal access',
          ].map(f => (
            <div key={f} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <span style={{ color: P.green, fontSize: '14px', fontWeight: '700' }}>✓</span>
              <span style={{ fontSize: '13px', color: P.textSub }}>{f}</span>
            </div>
          ))}

          <Form method="post" style={{ marginTop: '24px' }}>
            <button
              type="submit"
              style={{
                width: '100%', padding: '14px',
                background: 'linear-gradient(135deg, #7C6FF7 0%, #5B4CF0 100%)',
                color: '#fff', border: 'none', borderRadius: '10px',
                fontSize: '15px', fontWeight: '700', cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(124,111,247,0.4)',
              }}
            >
              {isExpired ? 'Subscribe now →' : 'Upgrade to ' + planDisplay + ' →'}
            </button>
          </Form>

          <p style={{ margin: '12px 0 0', fontSize: '11px', color: P.textMuted, textAlign: 'center' }}>
            Billed securely through Shopify · Cancel anytime
          </p>
        </div>
      )}

    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
