import { useState, useEffect } from 'react';
import { Outlet, NavLink, useLoaderData, redirect, Form } from 'react-router';
import { requirePortalUser, destroyPortalSession, getPortalSession } from '../utils/portal-auth.server';
import { can } from '../utils/portal-permissions';
import { PORTAL_THEME_CSS } from '../utils/portal-theme';

export async function loader({ request }) {
  const { portalUser, shop } = await requirePortalUser(request);
  return { portalUser, shop, role: portalUser.role };
}

export async function action({ request }) {
  const formData = await request.formData();
  if (formData.get('intent') === 'logout') {
    const session = await getPortalSession(request);
    return redirect('/portal-login', {
      headers: { 'Set-Cookie': await destroyPortalSession(session) },
    });
  }
  return null;
}

// ── Nav icons (inline SVGs — no extra dependency) ─────────────────────────────
function IconHome({ size = 16, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}
function IconBox({ size = 16, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}
function IconUsers({ size = 16, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function IconTarget({ size = 16, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />
    </svg>
  );
}
function IconPlus({ size = 14, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
function IconSun({ size = 14, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}
function IconMoon({ size = 14, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

// ── Role badge ────────────────────────────────────────────────────────────────
const ROLE_LIGHT = {
  Owner:  { bg: '#EDE9FE', text: '#5B21B6' },
  Editor: { bg: '#DBEAFE', text: '#1E40AF' },
  Viewer: { bg: '#F3F4F6', text: '#374151' },
};
const ROLE_DARK = {
  Owner:  { bg: '#1A0D2E', text: '#C084FC' },
  Editor: { bg: '#0D2010', text: '#7CFF6B' },
  Viewer: { bg: '#1B2130', text: '#9AA3B2' },
};

// ── Sidebar nav item ──────────────────────────────────────────────────────────
function NavItem({ to, end, icon, label }) {
  return (
    <NavLink
      to={to}
      end={end}
      style={({ isActive }) => ({
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '8px 12px',
        borderRadius: '8px',
        textDecoration: 'none',
        fontSize: '13px',
        fontWeight: isActive ? '700' : '500',
        color: isActive ? 'var(--pt-accent)' : 'var(--pt-text-sub)',
        backgroundColor: isActive ? 'var(--pt-accent-light)' : 'transparent',
        transition: 'all 0.12s ease',
        marginBottom: '1px',
      })}
    >
      <span style={{ flexShrink: 0, opacity: 0.85 }}>{icon}</span>
      {label}
    </NavLink>
  );
}

// ── Layout ────────────────────────────────────────────────────────────────────
export default function PortalLayout() {
  const { portalUser, role } = useLoaderData();

  const [dark, setDark] = useState(null);

  useEffect(() => {
    const stored = localStorage.getItem('portal-theme');
    setDark(stored === 'dark');
  }, []);

  const toggleTheme = () => {
    setDark(prev => {
      const next = !prev;
      localStorage.setItem('portal-theme', next ? 'dark' : 'light');
      return next;
    });
  };

  const themeAttr = dark === null ? undefined : (dark ? 'dark' : 'light');
  const rc = (dark ? ROLE_DARK : ROLE_LIGHT)[role] || (dark ? ROLE_DARK : ROLE_LIGHT).Viewer;
  const initials = portalUser.name?.charAt(0).toUpperCase() || '?';

  return (
    <div
      data-portal-theme={themeAttr}
      suppressHydrationWarning
      style={{
        fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif',
        backgroundColor: 'var(--pt-bg)',
        minHeight: '100vh',
        display: 'flex',
        colorScheme: dark ? 'dark' : 'light',
      }}
    >
      <style suppressHydrationWarning>{PORTAL_THEME_CSS}</style>

      {/* ── Sidebar ───────────────────────────────────────────────── */}
      <aside style={{
        width: '220px',
        flexShrink: 0,
        backgroundColor: 'var(--pt-surface)',
        borderRight: '1px solid var(--pt-border)',
        display: 'flex',
        flexDirection: 'column',
        position: 'sticky',
        top: 0,
        height: '100vh',
        overflowY: 'auto',
        zIndex: 50,
      }}>

        {/* Logo */}
        <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid var(--pt-border)' }}>
          <img src="/fullname.png" alt="ZEEDY" style={{ height: '24px', width: 'auto', display: 'block' }} />
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <NavItem to="/portal"             end   icon={<IconHome  />} label="Dashboard"   />
          <NavItem to="/portal/seedings"          icon={<IconBox   />} label="Seedings"    />
          <NavItem to="/portal/influencers"       icon={<IconUsers />} label="Influencers" />
          <NavItem to="/portal/campaigns"         icon={<IconTarget/>} label="Campaigns"   />

          {can.createSeeding(role) && (
            <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--pt-border)' }}>
              <NavLink
                to="/portal/new"
                style={({ isActive }) => ({
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '9px 12px',
                  borderRadius: '8px',
                  textDecoration: 'none',
                  fontSize: '13px',
                  fontWeight: '700',
                  color: '#fff',
                  background: isActive
                    ? 'linear-gradient(135deg, #5B4CF0 0%, #7C6FF7 100%)'
                    : 'linear-gradient(135deg, #7C6FF7 0%, #9C8FFF 100%)',
                  boxShadow: '0 2px 8px rgba(124,111,247,0.3)',
                  transition: 'all 0.12s ease',
                })}
              >
                <IconPlus color="#fff" />
                New Seeding
              </NavLink>
            </div>
          )}
        </nav>

        {/* Bottom: user + controls */}
        <div style={{ padding: '12px 8px', borderTop: '1px solid var(--pt-border)' }}>

          {/* User row */}
          <NavLink
            to="/portal/profile"
            title="Edit profile"
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '8px',
              borderRadius: '8px',
              textDecoration: 'none',
              backgroundColor: isActive ? 'var(--pt-accent-faint)' : 'transparent',
              outline: isActive ? `1.5px solid var(--pt-accent)` : 'none',
              transition: 'all 0.12s',
              marginBottom: '6px',
            })}
          >
            {/* Avatar */}
            <div style={{
              width: '30px', height: '30px', borderRadius: '50%', flexShrink: 0,
              background: 'linear-gradient(135deg, #7C6FF7 0%, #A855F7 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '12px', fontWeight: '800', color: '#fff',
            }}>
              {initials}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '12px', fontWeight: '700', color: 'var(--pt-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {portalUser.name}
              </div>
              <span style={{
                fontSize: '9px', fontWeight: '800', textTransform: 'uppercase',
                letterSpacing: '0.5px', padding: '1px 6px', borderRadius: '20px',
                backgroundColor: rc.bg, color: rc.text,
              }}>
                {role}
              </span>
            </div>
          </NavLink>

          {/* Sign out + theme toggle row */}
          <div style={{ display: 'flex', gap: '6px' }}>
            <Form method="post" style={{ flex: 1 }}>
              <input type="hidden" name="intent" value="logout" />
              <button type="submit" style={{
                width: '100%',
                padding: '7px 10px',
                backgroundColor: 'transparent',
                border: '1px solid var(--pt-border)',
                borderRadius: '7px',
                fontSize: '11px',
                color: 'var(--pt-text-sub)',
                cursor: 'pointer',
                fontWeight: '600',
                textAlign: 'left',
              }}>
                Sign out
              </button>
            </Form>

            {/* Theme toggle button */}
            <button
              type="button"
              suppressHydrationWarning
              onClick={toggleTheme}
              title={dark ? 'Light mode' : 'Dark mode'}
              style={{
                flexShrink: 0,
                padding: '7px 10px',
                backgroundColor: 'transparent',
                border: '1px solid var(--pt-border)',
                borderRadius: '7px',
                cursor: 'pointer',
                color: 'var(--pt-text-sub)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {dark
                ? <IconSun  size={14} color="var(--pt-text-sub)" />
                : <IconMoon size={14} color="var(--pt-text-sub)" />
              }
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main content ──────────────────────────────────────────── */}
      <main style={{ flex: 1, minWidth: 0, padding: '28px 32px' }}>
        <Outlet />
      </main>
    </div>
  );
}
