import { Outlet, useRouteError, useLocation } from 'react-router';
import { authenticate } from '../shopify.server';
import { boundary } from '@shopify/shopify-app-react-router/server';

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
  return { shop: session.shop };
}

export default function AppLayout() {
  const loc = useLocation();
  const isSettings = loc.pathname.startsWith('/app/settings');

  return (
    <div style={{
      fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif',
      backgroundColor: P.bg,
      minHeight: '100vh',
    }}>
      {/*
        ui-nav-menu tells Shopify admin to render navigation items in its own
        chrome. Shopify handles the full-page navigation (with session token),
        so authenticate.admin works correctly on each page load.
      */}
      <ui-nav-menu>
        <a href="/app" rel="home">Dashboard</a>
        <a href="/app/settings">Team &amp; Access</a>
      </ui-nav-menu>

      {/* In-page tab bar — purely visual, reflects current route */}
      <div style={{
        backgroundColor: P.surface,
        borderBottom: `1px solid ${P.border}`,
        padding: '0 32px',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
      }}>
        {[
          { href: '/app',          label: 'Dashboard',    active: !isSettings },
          { href: '/app/settings', label: 'Team & Access', active: isSettings },
        ].map(({ href, label, active }) => (
          <a key={href} href={href} style={{
            padding: '14px 16px',
            fontSize: '13px',
            fontWeight: active ? '700' : '500',
            color: active ? P.accent : P.textSub,
            textDecoration: 'none',
            borderBottom: active ? `2px solid ${P.accent}` : '2px solid transparent',
            marginBottom: '-1px',
            transition: 'color 0.12s',
            whiteSpace: 'nowrap',
          }}>
            {label}
          </a>
        ))}
      </div>

      <Outlet />
    </div>
  );
}

export function shouldRevalidate() {
  return false;
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
