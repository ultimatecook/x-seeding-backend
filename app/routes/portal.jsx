import { useState, useEffect } from 'react';
import { Outlet, NavLink, useLoaderData, redirect, Form } from 'react-router';
import { requirePortalUser, destroyPortalSession, getPortalSession } from '../utils/portal-auth.server';
import { can } from '../utils/portal-permissions';
import { D, PORTAL_THEME_CSS } from '../utils/portal-theme';

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

// ─── Theme Toggle Button (fixed bottom-right) ─────────────────────────────────
function ThemeToggle({ dark, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      suppressHydrationWarning
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: 9999,
        width: '56px',
        height: '30px',
        borderRadius: '15px',
        border: `1.5px solid ${dark ? '#4CD964' : '#D1CEEA'}`,
        cursor: 'pointer',
        padding: 0,
        backgroundColor: dark ? '#0D2010' : '#EDE9FF',
        boxShadow: dark
          ? '0 0 14px rgba(124,255,107,0.25), 0 4px 12px rgba(0,0,0,0.4)'
          : '0 2px 8px rgba(0,0,0,0.12)',
        transition: 'all 0.2s ease',
      }}
    >
      <span
        suppressHydrationWarning
        style={{
          position: 'absolute',
          top: '3px',
          left: dark ? '29px' : '3px',
          width: '22px',
          height: '22px',
          borderRadius: '50%',
          backgroundColor: dark ? '#7CFF6B' : '#7C6FF7',
          transition: 'left 0.2s ease, background-color 0.2s ease',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '12px',
          lineHeight: 1,
          boxShadow: dark ? '0 0 8px rgba(124,255,107,0.5)' : '0 1px 4px rgba(0,0,0,0.2)',
        }}
      >
        {dark ? '🌙' : '☀️'}
      </span>
    </button>
  );
}

// ─── Role badge colors (adapt to theme via inline logic) ──────────────────────
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

// ─── Layout ───────────────────────────────────────────────────────────────────
export default function PortalLayout() {
  const { portalUser, role } = useLoaderData();

  // Read from localStorage — use null as "not yet hydrated" to avoid mismatch
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

  // While hydrating (dark===null) render with no data-theme so server & client match
  const themeAttr = dark === null ? undefined : (dark ? 'dark' : 'light');
  const rc = (dark ? ROLE_DARK : ROLE_LIGHT)[role] || (dark ? ROLE_DARK : ROLE_LIGHT).Viewer;

  const navItems = [
    { to: '/portal',             label: 'Dashboard',   end: true },
    { to: '/portal/seedings',    label: 'Seedings' },
    { to: '/portal/influencers', label: 'Influencers' },
    { to: '/portal/campaigns',   label: 'Campaigns' },
  ];

  return (
    <div
      data-portal-theme={themeAttr}
      suppressHydrationWarning
      style={{
        fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif',
        backgroundColor: D.bg,
        minHeight: '100vh',
        colorScheme: dark ? 'dark' : 'light',
      }}
    >
      {/* Inject theme CSS */}
      <style suppressHydrationWarning>{PORTAL_THEME_CSS}</style>

      {/* ── Top header bar ────────────────────────────────────────── */}
      <header style={{
        backgroundColor: D.surface,
        borderBottom: `1px solid ${D.border}`,
        position: 'sticky',
        top: 0,
        zIndex: 100,
        boxShadow: D.shadow,
      }}>
        <div style={{
          maxWidth: '1200px',
          margin: '0 auto',
          padding: '0 28px',
          height: '56px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '24px',
        }}>

          {/* Logo + brand */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            <img src="/logoonly.png" alt="Zeedy" style={{ height: '28px', width: 'auto' }} />
            <img src="/fullname.png" alt="ZEEDY" style={{ height: '22px', width: 'auto' }} />
          </div>

          {/* Nav links */}
          <nav style={{ display: 'flex', alignItems: 'center', gap: '2px', flex: 1 }}>
            {navItems.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                style={({ isActive }) => ({
                  padding: '6px 14px',
                  borderRadius: '7px',
                  textDecoration: 'none',
                  fontSize: '13px',
                  fontWeight: isActive ? '700' : '500',
                  color: isActive ? D.accent : D.textSub,
                  backgroundColor: isActive ? D.accentLight : 'transparent',
                  transition: 'all 0.12s',
                })}
              >
                {item.label}
              </NavLink>
            ))}

            {can.createSeeding(role) && (
              <NavLink
                to="/portal/new"
                style={({ isActive }) => ({
                  marginLeft: '8px',
                  padding: '6px 14px',
                  borderRadius: '7px',
                  textDecoration: 'none',
                  fontSize: '13px',
                  fontWeight: '700',
                  color: '#FFFFFF',
                  background: isActive
                    ? 'linear-gradient(135deg, #5B4CF0 0%, #7C6FF7 100%)'
                    : 'linear-gradient(135deg, #7C6FF7 0%, #9C8FFF 100%)',
                  boxShadow: '0 2px 6px rgba(124,111,247,0.3)',
                  transition: 'all 0.12s',
                })}
              >
                + New Seeding
              </NavLink>
            )}
          </nav>

          {/* Right side: user + sign out */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>

            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '13px', fontWeight: '700', color: D.text, lineHeight: 1.2 }}>
                {portalUser.name}
              </div>
              <div style={{ fontSize: '11px', color: D.textMuted, lineHeight: 1.2 }}>
                {portalUser.email}
              </div>
            </div>

            {/* Avatar — links to profile */}
            <NavLink
              to="/portal/profile"
              title="Edit profile"
              style={({ isActive }) => ({
                width: '32px', height: '32px',
                borderRadius: '50%',
                background: `linear-gradient(135deg, ${D.accent} 0%, ${D.purple} 100%)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '12px', fontWeight: '800', color: '#0D0F14',
                flexShrink: 0,
                textDecoration: 'none',
                outline: isActive ? `2px solid ${D.accent}` : 'none',
                outlineOffset: '2px',
                transition: 'outline 0.1s',
              })}
            >
              {portalUser.name?.charAt(0).toUpperCase() || '?'}
            </NavLink>

            {/* Role badge */}
            <span style={{
              fontSize: '10px', fontWeight: '800', textTransform: 'uppercase',
              letterSpacing: '0.6px', padding: '3px 8px', borderRadius: '20px',
              backgroundColor: rc.bg, color: rc.text,
              transition: 'background-color 0.2s, color 0.2s',
            }}>
              {role}
            </span>

            <Form method="post">
              <input type="hidden" name="intent" value="logout" />
              <button type="submit" style={{
                padding: '6px 12px',
                backgroundColor: 'transparent',
                border: `1px solid ${D.border}`,
                borderRadius: '7px',
                fontSize: '12px',
                color: D.textSub,
                cursor: 'pointer',
                fontWeight: '600',
              }}>
                Sign out
              </button>
            </Form>
          </div>
        </div>
      </header>

      {/* ── Page content ──────────────────────────────────────────── */}
      <main style={{
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '28px',
      }}>
        <Outlet />
      </main>

      {/* ── Fixed theme toggle — bottom right corner ──────────────── */}
      <ThemeToggle dark={!!dark} onToggle={toggleTheme} />
    </div>
  );
}
