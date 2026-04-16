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

// ── Icons ─────────────────────────────────────────────────────────────────────
function IconHome({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}
function IconBox({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}
function IconUsers({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function IconTarget({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}
function IconPlus({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
function IconSun({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}
function IconMoon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
function IconLogout({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
function IconChevronsLeft({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="11 17 6 12 11 7" />
      <polyline points="18 17 13 12 18 7" />
    </svg>
  );
}
function IconChevronsRight({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="13 17 18 12 13 7" />
      <polyline points="6 17 11 12 6 7" />
    </svg>
  );
}

// ── Role colours ──────────────────────────────────────────────────────────────
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

// ── Sidebar nav link ───────────────────────────────────────────────────────────
function NavItem({ to, end, icon, label, collapsed }) {
  return (
    <NavLink
      to={to}
      end={end}
      title={collapsed ? label : undefined}
      style={({ isActive }) => ({
        display:         'flex',
        alignItems:      'center',
        justifyContent:  collapsed ? 'center' : 'flex-start',
        gap:             collapsed ? 0 : '10px',
        padding:         collapsed ? '10px 0' : '8px 12px',
        borderRadius:    '8px',
        textDecoration:  'none',
        fontSize:        '13px',
        fontWeight:      isActive ? '700' : '500',
        color:           isActive ? 'var(--pt-accent)' : 'var(--pt-text-sub)',
        backgroundColor: isActive ? 'var(--pt-accent-light)' : 'transparent',
        transition:      'all 0.12s ease',
        marginBottom:    '1px',
        overflow:        'hidden',
      })}
    >
      <span style={{ flexShrink: 0, opacity: 0.85 }}>{icon}</span>
      {!collapsed && (
        <span style={{ overflow: 'hidden', whiteSpace: 'nowrap' }}>{label}</span>
      )}
    </NavLink>
  );
}

// ── Small icon button (bottom area) ──────────────────────────────────────────
function IconBtn({ onClick, title, children, type = 'button' }) {
  return (
    <button
      type={type}
      onClick={onClick}
      title={title}
      style={{
        width: '32px', height: '32px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'transparent',
        border: '1px solid var(--pt-border)',
        borderRadius: '7px',
        cursor: 'pointer',
        color: 'var(--pt-text-sub)',
        flexShrink: 0,
        padding: 0,
      }}
    >
      {children}
    </button>
  );
}

// ── Layout ────────────────────────────────────────────────────────────────────
export default function PortalLayout() {
  const { portalUser, role } = useLoaderData();

  const [dark,      setDark]      = useState(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const storedTheme = localStorage.getItem('portal-theme');
    const storedNav   = localStorage.getItem('portal-nav-collapsed');
    setDark(storedTheme === 'dark');
    if (storedNav === 'true') setCollapsed(true);
  }, []);

  const toggleTheme = () => {
    setDark(prev => {
      const next = !prev;
      localStorage.setItem('portal-theme', next ? 'dark' : 'light');
      return next;
    });
  };

  const toggleCollapsed = () => {
    setCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('portal-nav-collapsed', next ? 'true' : 'false');
      return next;
    });
  };

  const themeAttr = dark === null ? undefined : (dark ? 'dark' : 'light');
  const rc        = (dark ? ROLE_DARK : ROLE_LIGHT)[role] || (dark ? ROLE_DARK : ROLE_LIGHT).Viewer;
  const initials  = portalUser.name?.charAt(0).toUpperCase() || '?';

  const NAV_W = collapsed ? '64px' : '220px';

  return (
    <div
      data-portal-theme={themeAttr}
      suppressHydrationWarning
      style={{
        fontFamily:      '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif',
        backgroundColor: 'var(--pt-bg)',
        minHeight:       '100vh',
        display:         'flex',
        colorScheme:     dark ? 'dark' : 'light',
      }}
    >
      <style suppressHydrationWarning>{PORTAL_THEME_CSS}</style>

      {/* ── Sidebar ───────────────────────────────────────────────── */}
      <aside style={{
        width:           NAV_W,
        flexShrink:      0,
        backgroundColor: 'var(--pt-surface)',
        borderRight:     '1px solid var(--pt-border)',
        display:         'flex',
        flexDirection:   'column',
        position:        'sticky',
        top:             0,
        height:          '100vh',
        overflowY:       'auto',
        overflowX:       'hidden',
        zIndex:          50,
        transition:      'width 0.2s ease',
      }}>

        {/* ── Logo ───────────────────────────────────────────────── */}
        <div style={{
          height:        '64px',
          flexShrink:    0,
          borderBottom:  '1px solid var(--pt-border)',
          display:       'flex',
          alignItems:    'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          padding:       collapsed ? '0' : '0 14px 0 18px',
        }}>
          {collapsed ? (
            // Collapsed: "Z" monogram
            <button
              onClick={toggleCollapsed}
              title="Expand sidebar"
              style={{
                background:     'none',
                border:         'none',
                cursor:         'pointer',
                padding:        0,
                display:        'flex',
                alignItems:     'center',
                justifyContent: 'center',
                width:          '40px',
                height:         '40px',
                borderRadius:   '10px',
              }}
            >
              <img src="/logonly.png" alt="Z" style={{ height: '28px', width: 'auto', display: 'block' }} />
            </button>
          ) : (
            <>
              {/* Full logo */}
              <img
                src="/fullname.png"
                alt="ZEEDY"
                style={{ height: '30px', width: 'auto', display: 'block' }}
              />
              {/* Collapse button */}
              <button
                onClick={toggleCollapsed}
                title="Collapse sidebar"
                style={{
                  flexShrink:      0,
                  width:           '26px',
                  height:          '26px',
                  display:         'flex',
                  alignItems:      'center',
                  justifyContent:  'center',
                  backgroundColor: 'transparent',
                  border:          '1px solid var(--pt-border)',
                  borderRadius:    '6px',
                  cursor:          'pointer',
                  color:           'var(--pt-text-muted)',
                  padding:         0,
                }}
              >
                <IconChevronsLeft size={13} />
              </button>
            </>
          )}
        </div>

        {/* ── Nav ────────────────────────────────────────────────── */}
        <nav style={{ flex: 1, padding: collapsed ? '10px 8px' : '12px 8px',
          display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <NavItem to="/portal"             end   icon={<IconHome   />} label="Dashboard"   collapsed={collapsed} />
          <NavItem to="/portal/seedings"          icon={<IconBox    />} label="Seedings"    collapsed={collapsed} />
          <NavItem to="/portal/influencers"       icon={<IconUsers  />} label="Influencers" collapsed={collapsed} />
          <NavItem to="/portal/campaigns"         icon={<IconTarget />} label="Campaigns"   collapsed={collapsed} />

          {can.createSeeding(role) && (
            <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--pt-border)' }}>
              <NavLink
                to="/portal/new"
                title={collapsed ? 'New Seeding' : undefined}
                style={({ isActive }) => ({
                  display:        'flex',
                  alignItems:     'center',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  gap:            collapsed ? 0 : '8px',
                  padding:        collapsed ? '10px 0' : '9px 12px',
                  borderRadius:   '8px',
                  textDecoration: 'none',
                  fontSize:       '13px',
                  fontWeight:     '700',
                  color:          '#fff',
                  background:     isActive
                    ? 'linear-gradient(135deg, #5B4CF0 0%, #7C6FF7 100%)'
                    : 'linear-gradient(135deg, #7C6FF7 0%, #9C8FFF 100%)',
                  boxShadow:      '0 2px 8px rgba(124,111,247,0.3)',
                  transition:     'all 0.12s ease',
                  overflow:       'hidden',
                })}
              >
                <IconPlus />
                {!collapsed && 'New Seeding'}
              </NavLink>
            </div>
          )}

          {/* Expand button (only shown when collapsed, at the bottom of nav) */}
          {collapsed && (
            <button
              onClick={toggleCollapsed}
              title="Expand sidebar"
              style={{
                marginTop:      'auto',
                display:        'flex',
                alignItems:     'center',
                justifyContent: 'center',
                padding:        '10px 0',
                borderRadius:   '8px',
                backgroundColor: 'transparent',
                border:         'none',
                cursor:         'pointer',
                color:          'var(--pt-text-muted)',
                width:          '100%',
              }}
            >
              <IconChevronsRight size={14} />
            </button>
          )}
        </nav>

        {/* ── Bottom: user + controls ─────────────────────────────── */}
        <div style={{ padding: collapsed ? '12px 8px' : '12px 8px',
          borderTop: '1px solid var(--pt-border)', flexShrink: 0 }}>

          {collapsed ? (
            // Collapsed bottom: stacked icon buttons
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
              {/* Avatar */}
              <NavLink to="/portal/profile" title={portalUser.name} style={{ textDecoration: 'none' }}>
                <div style={{
                  width: '32px', height: '32px', borderRadius: '50%',
                  background: 'linear-gradient(135deg, #7C6FF7 0%, #A855F7 100%)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '13px', fontWeight: '800', color: '#fff',
                }}>
                  {initials}
                </div>
              </NavLink>

              {/* Theme */}
              <IconBtn onClick={toggleTheme} title={dark ? 'Light mode' : 'Dark mode'}>
                {dark ? <IconSun /> : <IconMoon />}
              </IconBtn>

              {/* Sign out */}
              <Form method="post">
                <input type="hidden" name="intent" value="logout" />
                <IconBtn type="submit" title="Sign out">
                  <IconLogout />
                </IconBtn>
              </Form>
            </div>
          ) : (
            // Expanded bottom: full user card + controls
            <>
              <NavLink
                to="/portal/profile"
                title="Edit profile"
                style={({ isActive }) => ({
                  display:         'flex',
                  alignItems:      'center',
                  gap:             '10px',
                  padding:         '8px',
                  borderRadius:    '8px',
                  textDecoration:  'none',
                  backgroundColor: isActive ? 'var(--pt-accent-faint)' : 'transparent',
                  outline:         isActive ? '1.5px solid var(--pt-accent)' : 'none',
                  transition:      'all 0.12s',
                  marginBottom:    '6px',
                })}
              >
                <div style={{
                  width: '30px', height: '30px', borderRadius: '50%', flexShrink: 0,
                  background: 'linear-gradient(135deg, #7C6FF7 0%, #A855F7 100%)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '12px', fontWeight: '800', color: '#fff',
                }}>
                  {initials}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '12px', fontWeight: '700', color: 'var(--pt-text)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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

              <div style={{ display: 'flex', gap: '6px' }}>
                <Form method="post" style={{ flex: 1 }}>
                  <input type="hidden" name="intent" value="logout" />
                  <button type="submit" style={{
                    width: '100%', padding: '7px 10px',
                    backgroundColor: 'transparent', border: '1px solid var(--pt-border)',
                    borderRadius: '7px', fontSize: '11px', color: 'var(--pt-text-sub)',
                    cursor: 'pointer', fontWeight: '600', textAlign: 'left',
                  }}>
                    Sign out
                  </button>
                </Form>

                <button
                  type="button"
                  suppressHydrationWarning
                  onClick={toggleTheme}
                  title={dark ? 'Light mode' : 'Dark mode'}
                  style={{
                    flexShrink: 0, padding: '7px 10px',
                    backgroundColor: 'transparent', border: '1px solid var(--pt-border)',
                    borderRadius: '7px', cursor: 'pointer', color: 'var(--pt-text-sub)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {dark ? <IconSun /> : <IconMoon />}
                </button>
              </div>
            </>
          )}
        </div>
      </aside>

      {/* ── Main content ──────────────────────────────────────────── */}
      <main style={{ flex: 1, minWidth: 0, padding: '28px 32px' }}>
        <Outlet />
      </main>
    </div>
  );
}
