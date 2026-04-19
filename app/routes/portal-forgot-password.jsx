import { Form, useActionData } from 'react-router';
import { randomBytes } from 'crypto';
import prisma from '../db.server';
import { sendPasswordResetEmail } from '../utils/email.server';
import { rateLimit, getClientIp } from '../utils/rate-limit.server';

const APP_URL = process.env.SHOPIFY_APP_URL || 'https://www.zeedy.xyz';

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

export async function action({ request }) {
  // 5 attempts per IP per 15 minutes
  const ip = getClientIp(request);
  const { allowed } = rateLimit(`forgot:${ip}`, 5, 15 * 60 * 1000);
  if (!allowed) {
    return { sent: true }; // silently throttle — don't reveal rate limiting
  }

  const formData = await request.formData();
  const email    = String(formData.get('email') || '').toLowerCase().trim();

  if (!email) {
    return { error: 'Please enter your email address.' };
  }

  // Always return success to avoid leaking whether an address is registered
  const user = await prisma.portalUser.findFirst({
    where: { email, acceptedAt: { not: null } },
  });

  if (user) {
    const token   = randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.portalUser.update({
      where: { id: user.id },
      data:  { resetToken: token, resetTokenExpires: expires },
    });

    const resetUrl = `${APP_URL}/portal-reset-password?token=${token}`;
    await sendPasswordResetEmail({ to: email, resetUrl });
  }

  return { sent: true };
}

export default function ForgotPassword() {
  const actionData = useActionData();

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
        <div style={{ marginBottom: '32px' }}>
          <img src="/namelogo.svg" alt="ZEEDY" style={{ height: '32px', width: 'auto', display: 'block' }} />
        </div>

        {actionData?.sent ? (
          <div>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>📬</div>
            <h2 style={{ margin: '0 0 8px', fontSize: '20px', fontWeight: '800', color: P.text }}>
              Check your email
            </h2>
            <p style={{ margin: '0 0 24px', fontSize: '13px', color: P.textSub, lineHeight: 1.6 }}>
              If an account exists for that address, we've sent a password reset link. It expires in 1 hour.
            </p>
            <a href="/portal-login" style={{ color: P.accent, fontWeight: '700', fontSize: '14px', textDecoration: 'none' }}>
              ← Back to sign in
            </a>
          </div>
        ) : (
          <>
            <h2 style={{ margin: '0 0 6px', fontSize: '20px', fontWeight: '800', color: P.text, letterSpacing: '-0.3px' }}>
              Forgot your password?
            </h2>
            <p style={{ margin: '0 0 24px', fontSize: '13px', color: P.textSub }}>
              Enter your email and we'll send you a reset link.
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
                  placeholder="you@example.com"
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
                Send reset link →
              </button>
            </Form>

            <div style={{ marginTop: '20px', textAlign: 'center' }}>
              <a href="/portal-login" style={{ color: P.textSub, fontSize: '13px', textDecoration: 'none' }}>
                ← Back to sign in
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
