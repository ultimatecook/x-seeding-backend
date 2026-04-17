import { Outlet, useRouteError, NavLink } from 'react-router';
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
  return (
    <div style={{
      fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif',
      backgroundColor: P.bg,
      minHeight: '100vh',
    }}>
      {/* ── Top nav tabs ─────────────────────────────────────── */}
      <div style={{
        backgroundColor: P.surface,
        borderBottom: `1px solid ${P.border}`,
        padding: '0 32px',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
      }}>
        {[
          { to: '/app',          label: 'Dashboard',    end: true },
          { to: '/app/settings', label: 'Team & Access' },
        ].map(({ to, label, end }) => (
          <NavLink key={to} to={to} end={end} style={({ isActive }) => ({
            padding: '14px 16px',
            fontSize: '13px',
            fontWeight: isActive ? '700' : '500',
            color: isActive ? P.accent : P.textSub,
            textDecoration: 'none',
            borderBottom: isActive ? `2px solid ${P.accent}` : '2px solid transparent',
            marginBottom: '-1px',
            transition: 'color 0.12s',
            whiteSpace: 'nowrap',
          })}>
            {label}
          </NavLink>
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
