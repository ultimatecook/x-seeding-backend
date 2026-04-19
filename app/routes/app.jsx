import { Outlet, useLocation, useRouteError, useLoaderData } from 'react-router';
import { useEffect } from 'react';
import { authenticate } from '../shopify.server';
import { boundary } from '@shopify/shopify-app-react-router/server';
import { AppProvider } from '@shopify/shopify-app-react-router/react';
import { getOrCreateBilling, refreshBillingStatus } from '../utils/billing.server';

const P = {
  accent:  '#7C6FF7',
  border:  '#E5E3F0',
  bg:      '#F7F6FB',
  surface: '#FFFFFF',
  text:    '#1A1523',
  textSub: '#6B6880',
};

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);

  // Bootstrap billing — creates trial record on first install, syncs expired status
  const rawBilling = await getOrCreateBilling(session.shop);
  const billing    = await refreshBillingStatus(rawBilling);

  return {
    shop:   session.shop,
    host:   url.searchParams.get('host') || '',
    apiKey: process.env.SHOPIFY_API_KEY || '',
    billing: {
      planStatus:    billing.planStatus,
      billingStatus: billing.billingStatus,
      trialEndsAt:   billing.trialEndsAt?.toISOString() ?? null,
    },
  };
}

export default function AppLayout() {
  const { apiKey, shop, host } = useLoaderData();
  const { pathname } = useLocation();

  useEffect(() => {
    // App Bridge 4.x doesn't automatically inject its JWT into React Router's
    // client-side data fetches. Patch window.fetch so every same-origin request
    // gets an Authorization header with the current session token.
    const orig = window.fetch.bind(window);
    window.fetch = async function (input, init = {}) {
      try {
        const url = typeof input === 'string' ? input : input?.url ?? '';
        const isSameOrigin = url.startsWith('/') || url.startsWith(window.location.origin);
        if (isSameOrigin && window.shopify?.idToken) {
          const token = await window.shopify.idToken();
          if (token) {
            init = { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } };
          }
        }
      } catch (_) {}
      return orig(input, init);
    };

    return () => {
      window.fetch = orig;
    };
  }, []);

  const isSettings = pathname.startsWith('/app/settings');
  const isBilling  = pathname.startsWith('/app/billing');

  /**
   * Navigate via a full iframe page-load rather than React Router client-side
   * navigation.  Client-side navigation in Shopify embedded apps requires
   * window.shopify.idToken() to inject an Authorization header into the loader
   * fetch — but that relies on App Bridge postMessage communication, which can
   * fail silently in some environments.  When it fails, authenticate.admin()
   * throws a redirect to the bounce page; React Router follows it as a
   * client-side redirect (rendering nothing) instead of as a real page load.
   *
   * A full page-load with shop + host params bypasses all of that:
   *   1. Browser GETs /app/settings?shop=X&host=Y&embedded=1
   *   2. authenticate.admin detects embedded=1 + missing id_token → redirects
   *      to bounce page (/auth/session-token)
   *   3. Bounce page initialises App Bridge fresh, obtains the JWT, redirects
   *      back to /app/settings?shop=X&host=Y&embedded=1&id_token=JWT
   *   4. authenticate.admin validates the JWT → page renders correctly
   */
  function navTo(path) {
    // Pick up shop/host from the loader (set on initial auth) or fall back to
    // the current URL search params (populated by the bounce-page redirect).
    const currentParams = new URLSearchParams(window.location.search);
    const resolvedShop = shop || currentParams.get('shop') || '';
    const resolvedHost = host || currentParams.get('host') || '';

    const params = new URLSearchParams();
    if (resolvedShop) params.set('shop', resolvedShop);
    if (resolvedHost) params.set('host', resolvedHost);
    params.set('embedded', '1');

    window.location.href = `${path}?${params.toString()}`;
  }

  return (
    <AppProvider embedded apiKey={apiKey}>
      <ui-nav-menu>
        <a href="/app" rel="home">Dashboard</a>
        <a href="/app/settings">Team</a>
        <a href="/app/billing">Billing</a>
      </ui-nav-menu>

      <div style={{
        fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif',
        backgroundColor: P.bg,
        minHeight: '100vh',
      }}>
        <div style={{
          backgroundColor: P.surface,
          borderBottom: `1px solid ${P.border}`,
          padding: '0 32px',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
        }}>
          <button onClick={() => navTo('/app')} style={tabStyle(!isSettings && !isBilling)}>Dashboard</button>
          <button onClick={() => navTo('/app/settings')} style={tabStyle(isSettings)}>Team</button>
          <button onClick={() => navTo('/app/billing')} style={tabStyle(isBilling)}>Billing</button>
        </div>

        <Outlet />
      </div>
    </AppProvider>
  );
}

function tabStyle(isActive) {
  return {
    padding: '14px 16px',
    fontSize: '13px',
    fontWeight: isActive ? '700' : '500',
    color: isActive ? P.accent : P.textSub,
    background: 'none',
    border: 'none',
    borderBottom: isActive ? `2px solid ${P.accent}` : '2px solid transparent',
    marginBottom: '-1px',
    cursor: 'pointer',
    transition: 'color 0.12s',
    whiteSpace: 'nowrap',
    fontFamily: 'inherit',
  };
}

export function shouldRevalidate() {
  return false;
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
