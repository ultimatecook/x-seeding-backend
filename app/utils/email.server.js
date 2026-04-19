/**
 * email.server.js
 * Minimal email service for authentication flows only.
 * Uses Resend. Set RESEND_API_KEY and EMAIL_FROM in your environment.
 */

import { Resend } from 'resend';

const APP_URL   = process.env.SHOPIFY_APP_URL || 'https://www.zeedy.xyz';
const FROM      = process.env.EMAIL_FROM      || 'Zeedy <noreply@zeedy.xyz>';

function getResend() {
  if (!process.env.RESEND_API_KEY) return null;
  return new Resend(process.env.RESEND_API_KEY);
}

// ── Templates ─────────────────────────────────────────────────────────────────

function baseTemplate(content) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F7F6FB;font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:48px 24px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
        <tr><td style="padding-bottom:28px;">
          <span style="font-size:20px;font-weight:900;color:#7C6FF7;letter-spacing:-0.5px;">ZEEDY</span>
        </td></tr>
        <tr><td style="background:#fff;border:1px solid #E5E3F0;border-radius:16px;padding:36px 36px 32px;">
          ${content}
        </td></tr>
        <tr><td style="padding-top:20px;font-size:11px;color:#A09CB8;text-align:center;">
          Zeedy · zeedy.xyz · You received this because an action was taken on your account.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function inviteTemplate({ name, inviteUrl }) {
  return baseTemplate(`
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:800;color:#1A1523;letter-spacing:-0.3px;">
      You've been invited to Zeedy
    </h2>
    <p style="margin:0 0 24px;font-size:14px;color:#6B6880;line-height:1.6;">
      Hi ${escapeHtml(name)}, you've been invited to access the Zeedy portal.
      Click below to set your password and get started.
    </p>
    <a href="${inviteUrl}"
       style="display:inline-block;padding:12px 28px;background:#7C6FF7;color:#fff;
              text-decoration:none;border-radius:9px;font-size:14px;font-weight:700;">
      Accept invite →
    </a>
    <p style="margin:24px 0 4px;font-size:12px;color:#A09CB8;">
      This link expires in 7 days. If you didn't expect this, you can ignore it.
    </p>
    <p style="margin:0;font-size:11px;color:#A09CB8;word-break:break-all;">
      ${inviteUrl}
    </p>
  `);
}

function resetTemplate({ resetUrl }) {
  return baseTemplate(`
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:800;color:#1A1523;letter-spacing:-0.3px;">
      Reset your password
    </h2>
    <p style="margin:0 0 24px;font-size:14px;color:#6B6880;line-height:1.6;">
      Someone requested a password reset for your Zeedy account.
      Click below to set a new password. This link expires in 1 hour.
    </p>
    <a href="${resetUrl}"
       style="display:inline-block;padding:12px 28px;background:#7C6FF7;color:#fff;
              text-decoration:none;border-radius:9px;font-size:14px;font-weight:700;">
      Reset password →
    </a>
    <p style="margin:24px 0 4px;font-size:12px;color:#A09CB8;">
      If you didn't request this, you can safely ignore this email.
    </p>
    <p style="margin:0;font-size:11px;color:#A09CB8;word-break:break-all;">
      ${resetUrl}
    </p>
  `);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Send an invite email to a new portal user.
 * Fails silently (logs) so it never blocks the invite flow.
 */
export async function sendInviteEmail({ to, name, inviteUrl }) {
  const resend = getResend();
  if (!resend) {
    console.warn('[email] RESEND_API_KEY not set — skipping invite email to', to);
    return;
  }
  try {
    await resend.emails.send({
      from:    FROM,
      to,
      subject: "You've been invited to Zeedy",
      html:    inviteTemplate({ name, inviteUrl }),
    });
    console.log('[email] invite sent to', to);
  } catch (e) {
    console.error('[email] sendInviteEmail failed:', e?.message);
  }
}

/**
 * Send a password reset email.
 * Fails silently (logs) so it never leaks whether the address exists.
 */
export async function sendPasswordResetEmail({ to, resetUrl }) {
  const resend = getResend();
  if (!resend) {
    console.warn('[email] RESEND_API_KEY not set — skipping reset email to', to);
    return;
  }
  try {
    await resend.emails.send({
      from:    FROM,
      to,
      subject: 'Reset your Zeedy password',
      html:    resetTemplate({ resetUrl }),
    });
    console.log('[email] reset email sent to', to);
  } catch (e) {
    console.error('[email] sendPasswordResetEmail failed:', e?.message);
  }
}
