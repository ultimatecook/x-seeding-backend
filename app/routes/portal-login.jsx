import { Form, useActionData, useSearchParams, redirect } from 'react-router';
import prisma from '../db.server';
import {
  getPortalSession,
  commitPortalSession,
  verifyPassword,
  getPortalUser,
} from '../utils/portal-auth.server';
import { C } from '../theme';

export async function loader({ request }) {
  // Already logged in — go to portal home
  const user = await getPortalUser(request);
  if (user) throw redirect('/portal');
  return null;
}

export async function action({ request }) {
  const formData = await request.formData();
  const email    = String(formData.get('email') || '').toLowerCase().trim();
  const password = String(formData.get('password') || '');

  if (!email || !password) {
    return { error: 'Email and password are required.' };
  }

  const user = await prisma.portalUser.findFirst({
    where: { email, acceptedAt: { not: null } },
  });

  if (!user || !user.passwordHash) {
    return { error: 'Invalid email or password.' };
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return { error: 'Invalid email or password.' };
  }

  const session = await getPortalSession(request);
  session.set('portalUserId', String(user.id));
  session.set('portalShop', user.shop);

  return redirect('/portal', {
    headers: { 'Set-Cookie': await commitPortalSession(session) },
  });
}

export default function PortalLogin() {
  const actionData   = useActionData();
  const [params]     = useSearchParams();
  const defaultEmail = params.get('email') || '';

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#F9F9F8',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{
        backgroundColor: '#fff',
        border: `1px solid ${C.border}`,
        borderRadius: '12px',
        padding: '40px',
        width: '100%',
        maxWidth: '400px',
        boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '28px' }}>
          <div style={{
            width: '32px', height: '32px',
            backgroundColor: C.accent,
            borderRadius: '8px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '16px', color: '#fff',
          }}>✦</div>
          <h1 style={{ margin: 0, fontSize: '17px', fontWeight: '800', color: C.text }}>
            X – Seeding Manager
          </h1>
        </div>

        <h2 style={{ margin: '0 0 20px', fontSize: '15px', fontWeight: '700', color: C.text }}>
          Sign in to your account
        </h2>

        {actionData?.error && (
          <div style={{
            padding: '10px 14px',
            backgroundColor: '#FEF2F2',
            color: '#DC2626',
            borderRadius: '6px',
            fontSize: '13px',
            marginBottom: '16px',
            fontWeight: '600',
          }}>
            {actionData.error}
          </div>
        )}

        <Form method="post" style={{ display: 'grid', gap: '14px' }}>
          <div style={{ display: 'grid', gap: '5px' }}>
            <label style={{ fontSize: '13px', fontWeight: '600', color: C.text }}>
              Email
            </label>
            <input
              name="email"
              type="email"
              autoComplete="email"
              defaultValue={defaultEmail}
              required
              style={{
                padding: '10px 12px',
                borderRadius: '6px',
                border: `1px solid ${C.border}`,
                fontSize: '14px',
                outline: 'none',
                width: '100%',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ display: 'grid', gap: '5px' }}>
            <label style={{ fontSize: '13px', fontWeight: '600', color: C.text }}>
              Password
            </label>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              style={{
                padding: '10px 12px',
                borderRadius: '6px',
                border: `1px solid ${C.border}`,
                fontSize: '14px',
                outline: 'none',
                width: '100%',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <button
            type="submit"
            style={{
              padding: '11px',
              backgroundColor: C.accent,
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: '700',
              cursor: 'pointer',
              marginTop: '4px',
            }}
          >
            Sign in
          </button>
        </Form>
      </div>
    </div>
  );
}
