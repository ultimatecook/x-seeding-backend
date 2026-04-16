import { Form, useActionData, useSearchParams, redirect } from 'react-router';
import prisma from '../db.server';
import {
  getPortalSession,
  commitPortalSession,
  verifyPassword,
  getPortalUser,
} from '../utils/portal-auth.server';

// Portal purple palette (hardcoded — login page has no theme provider)
const P = {
  accent:  '#7C6FF7',
  border:  '#E5E3F0',
  text:    '#1A1523',
  textSub: '#6B6880',
  bg:      '#F7F6FB',
};

export async function loader({ request }) {
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

  const inputStyle = {
    padding: '10px 12px',
    borderRadius: '8px',
    border: `1px solid ${P.border}`,
    fontSize: '14px',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    color: P.text,
    backgroundColor: '#fff',
  };

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: P.bg,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif',
    }}>
      <div style={{
        backgroundColor: '#fff',
        border: `1px solid ${P.border}`,
        borderRadius: '16px',
        padding: '40px',
        width: '100%',
        maxWidth: '400px',
        boxShadow: '0 4px 24px rgba(124,111,247,0.1)',
      }}>

        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '32px' }}>
          <img src="/logoonly.png" alt="Zeedy" style={{ height: '36px', width: 'auto' }} />
          <img src="/fullname.png" alt="ZEEDY" style={{ height: '28px', width: 'auto' }} />
        </div>

        <h2 style={{ margin: '0 0 6px', fontSize: '20px', fontWeight: '800', color: P.text, letterSpacing: '-0.3px' }}>
          Welcome back
        </h2>
        <p style={{ margin: '0 0 24px', fontSize: '13px', color: P.textSub }}>
          Sign in to your account to continue.
        </p>

        {actionData?.error && (
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
            {actionData.error}
          </div>
        )}

        <Form method="post" style={{ display: 'grid', gap: '14px' }}>
          <div style={{ display: 'grid', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: '700', color: P.textSub, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Email
            </label>
            <input
              name="email"
              type="email"
              autoComplete="email"
              defaultValue={defaultEmail}
              required
              style={inputStyle}
            />
          </div>

          <div style={{ display: 'grid', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: '700', color: P.textSub, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Password
            </label>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
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
              letterSpacing: '-0.1px',
            }}
          >
            Sign in →
          </button>
        </Form>
      </div>
    </div>
  );
}
