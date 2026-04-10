import { Outlet, NavLink, useLoaderData, redirect, Form } from 'react-router';
import { requirePortalUser, destroyPortalSession, getPortalSession } from '../utils/portal-auth.server';
import { can } from '../utils/portal-permissions';

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

const ROLE_COLOR = {
  Owner:  { bg: '#EDE9FE', text: '#5B21B6' },
  Editor: { bg: '#DBEAFE', text: '#1E40AF' },
  Viewer: { bg: '#F3F4F6', text: '#374151' },
};

export default function PortalLayout() {
  const { portalUser, role } = useLoaderData();
  const rc = ROLE_COLOR[role] || ROLE_COLOR.Viewer;

  const navItems = [
    { to: '/portal',             label: 'Dashboard', end: true },
    { to: '/portal/seedings',    label: 'Seedings' },
    { to: '/portal/influencers', label: 'Influencers' },
    { to: '/portal/campaigns',   label: 'Campaigns' },
  ];

  return (
    <div style={{
      fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif',
      backgroundColor: '#F7F8FA',
      minHeight: '100vh',
    }}>
      {/* ── Top header bar ─────────────────────────────────────── */}
      <header style={{
        backgroundColor: '#FFFFFF',
        borderBottom: '1px solid #E8E9EC',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
            <div style={{
              width: '30px', height: '30px',
              background: 'linear-gradient(135deg, #7C6FF7 0%, #5B4CF0 100%)',
              borderRadius: '8px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '14px', boxShadow: '0 2px 6px rgba(124,111,247,0.35)',
            }}>✦</div>
            <span style={{ fontSize: '14px', fontWeight: '800', letterSpacing: '-0.3px', color: '#111827' }}>
              X Seeding
            </span>
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
                  color: isActive ? '#7C6FF7' : '#6B7280',
                  backgroundColor: isActive ? '#EEF0FE' : 'transparent',
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
                  boxShadow: '0 2px 6px rgba(124,111,247,0.35)',
                  transition: 'all 0.12s',
                })}
              >
                + New Seeding
              </NavLink>
            )}
          </nav>

          {/* User info + sign out */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '13px', fontWeight: '700', color: '#111827', lineHeight: 1.2 }}>
                {portalUser.name}
              </div>
              <div style={{ fontSize: '11px', color: '#9CA3AF', lineHeight: 1.2 }}>
                {portalUser.email}
              </div>
            </div>

            {/* Avatar circle */}
            <div style={{
              width: '32px', height: '32px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #7C6FF7 0%, #A78BFA 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '12px', fontWeight: '800', color: '#FFF',
              flexShrink: 0,
            }}>
              {portalUser.name?.charAt(0).toUpperCase() || '?'}
            </div>

            {/* Role badge */}
            <span style={{
              fontSize: '10px', fontWeight: '800', textTransform: 'uppercase',
              letterSpacing: '0.6px', padding: '3px 8px', borderRadius: '20px',
              backgroundColor: rc.bg, color: rc.text,
            }}>
              {role}
            </span>

            <Form method="post">
              <input type="hidden" name="intent" value="logout" />
              <button type="submit" style={{
                padding: '6px 12px',
                backgroundColor: 'transparent',
                border: '1px solid #E8E9EC',
                borderRadius: '7px',
                fontSize: '12px',
                color: '#6B7280',
                cursor: 'pointer',
                fontWeight: '600',
                transition: 'all 0.12s',
              }}>
                Sign out
              </button>
            </Form>
          </div>
        </div>
      </header>

      {/* ── Page content ───────────────────────────────────────── */}
      <main style={{
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '28px',
      }}>
        <Outlet />
      </main>
    </div>
  );
}
