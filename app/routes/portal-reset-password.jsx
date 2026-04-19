import { Form, useActionData, useLoaderData, redirect } from 'react-router';
import prisma from '../db.server';
import {
  hashPassword,
  getPortalSession,
  commitPortalSession,
} from '../utils/portal-auth.server';

const P = {
  accent:  '#7C6FF7',
  border:  '#E5E3F0',
  text:    '#1A1523',
  textSub: '#6B6880',
  bg:      '#F7F6FB',
};

const inputStyle = {
  padding: '10px 12px',
  borderRadius: '8px',
  border: `1px solid ${P.border}`,
  fontSize: '14px',
  width: '100%',
  boxSizing: 'border-box',
  color: P.text,
  backgroundColor: '#fff',
};

export async function loader({ request }) {
  const url   = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) throw redirect('/portal-forgot-password');

  const user = await prisma.portalUser.findUnique({
    where: { resetToken: token },
  });

  if (!user) {
    return { valid: false, error: 'This reset link is invalid or has already been used.' };
  }

  if (user.resetTokenExpires && new Date() > user.resetTokenExpires) {
    return { valid: false, error: 'This reset link has expired. Please request a new one.' };
  }

  return { valid: true, token };
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

  const user = await prisma.portalUser.findUnique({ where: { resetToken: token } });

  if (!user) {
    return { error: 'Invalid or already used reset link.' };
  }

  if (user.resetTokenExpires && new Date() > user.resetTokenExpires) {
    return { error: 'This reset link has expired. Please request a new one.' };
  }

  const passwordHash = await hashPassword(password);

  await prisma.portalUser.update({
    where: { id: user.id },
    data: {
      passwordHash,
      resetToken:        null,
      resetTokenExpires: null,
    },
  });

  // Log them in immediately after reset
  const session = await getPortalSession(request);
  session.set('portalUserId', String(user.id));
  session.set('portalShop', user.shop);

  return redirect('/portal', {
    headers: { 'Set-Cookie': await commitPortalSession(session) },
  });
}

export default function ResetPassword() {
  const loaderData = useLoaderData();
  const actionData = useActionData();
  const error      = actionData?.error || loaderData?.error;

  const wrap = {
    minHeight: '100vh',
    backgroundColor: P.bg,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif',
  };

  const card = {
    backgroundColor: '#fff',
    border: `1px solid ${P.border}`,
    borderRadius: '16px',
    padding: '40px',
    width: '100%',
    maxWidth: '400px',
    boxShadow: '0 4px 24px rgba(124,111,247,0.1)',
  };

  if (!loaderData?.valid) {
    return (
      <div style={wrap}>
        <div style={{ ...card, textAlign: 'center' }}>
          <div style={{ marginBottom: '24px' }}>
            <img src="/namelogo.svg" alt="ZEEDY" style={{ height: '32px', width: 'auto', display: 'block', margin: '0 auto' }} />
          </div>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>⚠️</div>
          <p style={{ color: P.text, fontWeight: '600', marginBottom: '20px' }}>{loaderData?.error}</p>
          <a href="/portal-forgot-password" style={{ color: P.accent, fontWeight: '700', fontSize: '14px', textDecoration: 'none' }}>
            Request a new link →
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ marginBottom: '32px' }}>
          <img src="/namelogo.svg" alt="ZEEDY" style={{ height: '32px', width: 'auto', display: 'block' }} />
        </div>

        <h2 style={{ margin: '0 0 6px', fontSize: '20px', fontWeight: '800', color: P.text, letterSpacing: '-0.3px' }}>
          Set a new password
        </h2>
        <p style={{ margin: '0 0 24px', fontSize: '13px', color: P.textSub }}>
          Choose a strong password for your account.
        </p>

        {error && (
          <div style={{
            padding: '10px 14px',
            backgroundColor: '#FEF2F2',
            color: '#DC2626',
            border: '1px solid #FECACA',
            borderRadius: '8px',
            fontSize: '13px',
            marginBottom: '16px',
            fontWeight: '600',
          }}>
            {error}
          </div>
        )}

        <Form method="post" style={{ display: 'grid', gap: '14px' }}>
          <input type="hidden" name="token" value={loaderData.token} />

          <div style={{ display: 'grid', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: '700', color: P.textSub, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              New password
            </label>
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              required
              style={inputStyle}
            />
          </div>

          <div style={{ display: 'grid', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: '700', color: P.textSub, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Confirm password
            </label>
            <input
              name="confirm"
              type="password"
              autoComplete="new-password"
              placeholder="Repeat password"
              required
              style={inputStyle}
            />
          </div>

          <button
            type="submit"
            style={{
              padding: '12px',
              background: 'linear-gradient(135deg, #7C6FF7 0%, #5B4CF0 100%)',
              color: '#fff',
              border: 'none',
              borderRadius: '9px',
              fontSize: '14px',
              fontWeight: '700',
              cursor: 'pointer',
              marginTop: '4px',
              boxShadow: '0 2px 8px rgba(124,111,247,0.35)',
            }}
          >
            Set password →
          </button>
        </Form>
      </div>
    </div>
  );
}
