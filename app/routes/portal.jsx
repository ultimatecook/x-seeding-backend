import { Outlet, NavLink, useLoaderData, redirect, Form } from 'react-router';
import prisma from '../db.server';
import { requirePortalUser, destroyPortalSession, getPortalSession } from '../utils/portal-auth.server';
import { C } from '../theme';

export async function loader({ request }) {
  const { userId, shop } = await requirePortalUser(request);

  const portalUser = await prisma.portalUser.findUnique({ where: { id: userId } });
  if (!portalUser) throw redirect('/portal-login');

  return { portalUser, shop };
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

const navLinkStyle = ({ isActive }) => ({
  padding: '7px 16px',
  backgroundColor: isActive ? C.accent : 'transparent',
  color: isActive ? '#fff' : C.textSub,
  textDecoration: 'none',
  border: `1px solid ${isActive ? C.accent : C.border}`,
  fontSize: '13px',
  fontWeight: '600',
  borderRadius: '6px',
  transition: 'all 0.15s',
});

export default function PortalLayout() {
  const { portalUser } = useLoaderData();

  return (
    <div style={{
      fontFamily: 'system-ui, sans-serif',
      maxWidth: '1140px',
      margin: '0 auto',
      padding: '24px 20px',
      backgroundColor: C.bg,
      minHeight: '100vh',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        borderBottom: `1px solid ${C.border}`, paddingBottom: '16px', marginBottom: '32px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '28px', height: '28px', backgroundColor: C.accent, borderRadius: '6px',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px',
          }}>✦</div>
          <h1 style={{ margin: 0, fontSize: '15px', fontWeight: '800', letterSpacing: '-0.3px', color: C.text }}>
            X – Seeding Manager
          </h1>
        </div>

        <nav style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <NavLink to="/portal" end style={navLinkStyle}>Dashboard</NavLink>
          <NavLink to="/portal/seedings" style={navLinkStyle}>Seedings</NavLink>
          <NavLink to="/portal/influencers" style={navLinkStyle}>Influencers</NavLink>
          <NavLink to="/portal/campaigns" style={navLinkStyle}>Campaigns</NavLink>
          <NavLink to="/portal/new" style={({ isActive }) => ({
            ...navLinkStyle({ isActive }),
            backgroundColor: C.accent,
            color: '#fff',
            border: `1px solid ${C.accent}`,
          })}>+ New Seeding</NavLink>

          <div style={{ marginLeft: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', color: C.textSub, fontWeight: '600' }}>
              {portalUser.name}
            </span>
            <Form method="post">
              <input type="hidden" name="intent" value="logout" />
              <button type="submit" style={{
                padding: '6px 12px', backgroundColor: 'transparent',
                border: `1px solid ${C.border}`, borderRadius: '6px',
                fontSize: '12px', color: C.textSub, cursor: 'pointer', fontWeight: '600',
              }}>
                Sign out
              </button>
            </Form>
          </div>
        </nav>
      </div>
      <Outlet />
    </div>
  );
}
