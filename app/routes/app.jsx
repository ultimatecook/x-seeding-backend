import { Outlet, NavLink, useRouteError, useLoaderData } from 'react-router';
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
        {/* In-page tab bar — NavLink uses React Router's fetch so App Bridge injects the session token */}
        <div style={{
          backgroundColor: P.surface,
          borderBottom: `1px solid ${P.border}`,
          padding: '0 32px',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
        }}>
          <NavLink to="/app" end style={({ isActive }) => tabStyle(isActive)}>Dashboard</NavLink>
          <NavLink to="/app/settings" style={({ isActive }) => tabStyle(isActive)}>Team &amp; Access</NavLink>
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
    textDecoration: 'none',
    borderBottom: isActive ? `2px solid ${P.accent}` : '2px solid transparent',
    marginBottom: '-1px',
    transition: 'color 0.12s',
    whiteSpace: 'nowrap',
  };
}

export function shouldRevalidate() {
  return false;
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
