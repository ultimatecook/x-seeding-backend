import { Outlet, Link, useLocation, useRouteError, useLoaderData } from 'react-router';
import { useEffect } from 'react';
import { authenticate } from '../shopify.server';
import { boundary } from '@shopify/shopify-app-react-router/server';
import { AppProvider } from '@shopify/shopify-app-react-router/react';

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
  return { shop: session.shop, apiKey: process.env.SHOPIFY_API_KEY || '' };
}

export default function AppLayout() {
  const { apiKey } = useLoaderData();
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

  return (
    <AppProvider embedded apiKey={apiKey}>
      <ui-nav-menu>
        <a href="/app" rel="home">Dashboard</a>
        <a href="/app/settings">Team &amp; Access</a>
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
          {/* Use Link (anchor) not button+navigate — programmatic navigate() triggers
              App Bridge's postMessage URL-sync which fails inside the Shopify admin
              iframe due to origin mismatch, aborting the transition entirely. */}
          <Link to="/app" style={tabStyle(!isSettings)}>Dashboard</Link>
          <Link to="/app/settings" style={tabStyle(isSettings)}>Team &amp; Access</Link>
        </div>

        <Outlet />
      </div>
    </AppProvider>
  );
}

function tabStyle(isActive) {
  return {
    display: 'inline-block',
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
    textDecoration: 'none',
  };
}

export function shouldRevalidate() {
  return false;
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
