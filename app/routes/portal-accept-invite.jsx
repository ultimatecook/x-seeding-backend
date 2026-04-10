import { Form, useActionData, useLoaderData, redirect } from 'react-router';
import prisma from '../db.server';
import {
  hashPassword,
  getPortalSession,
  commitPortalSession,
} from '../utils/portal-auth.server';
import { C } from '../theme';

export async function loader({ request }) {
  const url   = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) throw redirect('/portal-login');

  const user = await prisma.portalUser.findUnique({
    where: { inviteToken: token },
  });

  if (!user) {
    return { error: 'This invite link is invalid or has already been used.', valid: false };
  }

  if (user.acceptedAt) {
    return { error: 'This invite has already been accepted. Please log in.', valid: false };
  }

  if (user.inviteExpires && new Date() > user.inviteExpires) {
    return { error: 'This invite link has expired. Ask your admin to resend it.', valid: false };
  }

  return { valid: true, token, email: user.email, name: user.name };
}

export async function action({ request }) {
  const formData = await request.formData();
  const token    = String(formData.get('token') || '');
  const password = String(formData.get('password') || '');
  const confirm  = String(formData.get('confirm') || '');

  if (password.length < 8) {
    return { error: 'Password must be at least 8 characters.' };
  }
  if (password !== confirm) {
    return { error: 'Passwords do not match.' };
  }

  const user = await prisma.portalUser.findUnique({ where: { inviteToken: token } });
  if (!user || user.acceptedAt) {
    return { error: 'Invalid or already used invite link.' };
  }

  const passwordHash = await hashPassword(password);

  await prisma.portalUser.update({
    where: { id: user.id },
    data: {
      passwordHash,
      inviteToken:   null,
      inviteExpires: null,
      acceptedAt:    new Date(),
    },
  });

  // Auto log in after accepting
  const session = await getPortalSession(request);
  session.set('portalUserId', String(user.id));
  session.set('portalShop', user.shop);

  return redirect('/portal', {
    headers: { 'Set-Cookie': await commitPortalSession(session) },
  });
}

export default function AcceptInvite() {
  const loaderData = useLoaderData();
  const actionData = useActionData();
  const error      = actionData?.error || loaderData?.error;

  if (!loaderData?.valid) {
    return (
      <div style={{
        minHeight: '100vh', backgroundColor: '#F9F9F8',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'system-ui, sans-serif',
      }}>
        <div style={{
          backgroundColor: '#fff', border: `1px solid ${C.border}`,
          borderRadius: '12px', padding: '40px', maxWidth: '400px', width: '100%',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>⚠️</div>
          <p style={{ color: C.text, fontWeight: '600', marginBottom: '16px' }}>{loaderData?.error}</p>
          <a href="/portal-login" style={{ color: C.accent, fontWeight: '700', fontSize: '14px' }}>
            Go to login →
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh', backgroundColor: '#F9F9F8',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{
        backgroundColor: '#fff', border: `1px solid ${C.border}`,
        borderRadius: '12px', padding: '40px', width: '100%', maxWidth: '400px',
        boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '28px' }}>
          <div style={{
            width: '32px', height: '32px', backgroundColor: C.accent, borderRadius: '8px',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', color: '#fff',
          }}>✦</div>
          <h1 style={{ margin: 0, fontSize: '17px', fontWeight: '800', color: C.text }}>
            X – Seeding Manager
          </h1>
        </div>

        <h2 style={{ margin: '0 0 6px', fontSize: '15px', fontWeight: '700', color: C.text }}>
          Welcome, {loaderData.name}!
        </h2>
        <p style={{ margin: '0 0 20px', fontSize: '13px', color: C.textSub }}>
          Set a password to activate your account ({loaderData.email}).
        </p>

        {error && (
          <div style={{
            padding: '10px 14px', backgroundColor: '#FEF2F2', color: '#DC2626',
            borderRadius: '6px', fontSize: '13px', marginBottom: '16px', fontWeight: '600',
          }}>
            {error}
          </div>
        )}

        <Form method="post" style={{ display: 'grid', gap: '14px' }}>
          <input type="hidden" name="token" value={loaderData.token} />

          <div style={{ display: 'grid', gap: '5px' }}>
            <label style={{ fontSize: '13px', fontWeight: '600', color: C.text }}>Password</label>
            <input
              name="password" type="password" autoComplete="new-password"
              placeholder="At least 8 characters" required
              style={{
                padding: '10px 12px', borderRadius: '6px', border: `1px solid ${C.border}`,
                fontSize: '14px', width: '100%', boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ display: 'grid', gap: '5px' }}>
            <label style={{ fontSize: '13px', fontWeight: '600', color: C.text }}>Confirm password</label>
            <input
              name="confirm" type="password" autoComplete="new-password"
              required
              style={{
                padding: '10px 12px', borderRadius: '6px', border: `1px solid ${C.border}`,
                fontSize: '14px', width: '100%', boxSizing: 'border-box',
              }}
            />
          </div>

          <button type="submit" style={{
            padding: '11px', backgroundColor: C.accent, color: '#fff',
            border: 'none', borderRadius: '6px', fontSize: '14px', fontWeight: '700',
            cursor: 'pointer', marginTop: '4px',
          }}>
            Activate account
          </button>
        </Form>
      </div>
    </div>
  );
}
