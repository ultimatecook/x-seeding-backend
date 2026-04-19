import { useState } from 'react';
import { useLoaderData, useActionData, Form, useNavigation } from 'react-router';
import prisma from '../db.server';
import { requirePortalUser, hashPassword, verifyPassword } from '../utils/portal-auth.server';
import { audit } from '../utils/audit.server.js';
import { D } from '../utils/portal-theme';
import { useT } from '../utils/i18n';

// ─── Loader ───────────────────────────────────────────────────────────────────
export async function loader({ request }) {
  const { portalUser } = await requirePortalUser(request);
  return { portalUser };
}

// ─── Action ───────────────────────────────────────────────────────────────────
export async function action({ request }) {
  const { shop, portalUser } = await requirePortalUser(request);
  const formData = await request.formData();
  const intent   = formData.get('intent');

  // ── Update name / email ────────────────────────────────────────────────────
  if (intent === 'updateProfile') {
    const name  = String(formData.get('name')  || '').trim().slice(0, 200);
    const email = String(formData.get('email') || '').trim().toLowerCase().slice(0, 254);

    if (!name)  return { error: 'Name is required.', intent };
    if (!email) return { error: 'Email is required.', intent };

    // Check uniqueness if email changed
    if (email !== portalUser.email) {
      const exists = await prisma.portalUser.findFirst({
        where: { shop, email, NOT: { id: portalUser.id } },
      });
      if (exists) return { error: 'That email is already in use.', intent };
    }

    await prisma.portalUser.update({
      where: { id: portalUser.id },
      data:  { name, email },
    });

    await audit({ shop, portalUser, action: 'updated_profile', entityType: 'portalUser', entityId: portalUser.id, detail: `Updated name/email` });
    return { success: 'Profile updated.', intent };
  }

  // ── Change password ────────────────────────────────────────────────────────
  if (intent === 'changePassword') {
    const current  = String(formData.get('currentPassword')  || '');
    const next     = String(formData.get('newPassword')      || '');
    const confirm  = String(formData.get('confirmPassword')  || '');

    if (!current) return { error: 'Current password is required.', intent };
    if (!next)    return { error: 'New password is required.', intent };
    if (next.length < 8) return { error: 'New password must be at least 8 characters.', intent };
    if (next !== confirm) return { error: 'Passwords do not match.', intent };

    if (!portalUser.passwordHash) return { error: 'No password set on this account.', intent };

    const valid = await verifyPassword(current, portalUser.passwordHash);
    if (!valid) return { error: 'Current password is incorrect.', intent };

    const passwordHash = await hashPassword(next);
    await prisma.portalUser.update({ where: { id: portalUser.id }, data: { passwordHash } });
    await audit({ shop, portalUser, action: 'changed_password', entityType: 'portalUser', entityId: portalUser.id, detail: 'Password changed' });
    return { success: 'Password updated successfully.', intent };
  }

  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const ROLE_COLOR = {
  Owner:  { bg: D.purpleFaint, text: D.purpleLight },
  Editor: { bg: D.accentLight, text: D.accentText  },
  Viewer: { bg: D.surfaceHigh, text: D.textSub      },
};

function card(extra = {}) {
  return {
    background:   D.surface,
    border:       `1px solid ${D.border}`,
    borderRadius: D.radius,
    padding:      '24px',
    ...extra,
  };
}

function label(text) {
  return {
    display:      'block',
    fontSize:     '12px',
    fontWeight:   '600',
    color:        D.textSub,
    marginBottom: '6px',
    letterSpacing:'0.3px',
  };
}

const inputStyle = {
  width:         '100%',
  padding:       '10px 12px',
  borderRadius:  '8px',
  border:        `1px solid ${D.border}`,
  fontSize:      '14px',
  color:         D.text,
  background:    D.surface,
  boxSizing:     'border-box',
  display:       'block',
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function PortalProfile() {
  const { portalUser }  = useLoaderData();
  const actionData      = useActionData();
  const navigation      = useNavigation();
  const { t }           = useT();
  const isSubmitting    = navigation.state === 'submitting';
  const pendingIntent   = navigation.formData?.get('intent');

  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw,     setShowNewPw]     = useState(false);

  const rc      = ROLE_COLOR[portalUser.role] || ROLE_COLOR.Viewer;
  const initials = portalUser.name?.slice(0, 2).toUpperCase() || '??';

  const profileError   = actionData?.intent === 'updateProfile'  && actionData?.error;
  const profileSuccess = actionData?.intent === 'updateProfile'  && actionData?.success;
  const passwordError  = actionData?.intent === 'changePassword' && actionData?.error;
  const passwordSuccess= actionData?.intent === 'changePassword' && actionData?.success;

  return (
    <div style={{ maxWidth: '640px' }}>

      {/* Page title */}
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ margin: 0, fontSize: '22px', fontWeight: '800', color: D.text, letterSpacing: '-0.4px' }}>
          {t('profile.title')}
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: D.textSub }}>
          Manage your name, email, and password.
        </p>
      </div>

      {/* Avatar + role header */}
      <div style={{ ...card({ marginBottom: '20px' }), display: 'flex', alignItems: 'center', gap: '18px' }}>
        <div style={{
          width: '60px', height: '60px', borderRadius: '50%', flexShrink: 0,
          background: `linear-gradient(135deg, ${D.accent} 0%, ${D.purple} 100%)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '20px', fontWeight: '900', color: '#fff',
          boxShadow: `0 0 20px color-mix(in srgb, ${D.accent} 30%, transparent)`,
        }}>
          {initials}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '18px', fontWeight: '800', color: D.text, marginBottom: '4px' }}>
            {portalUser.name}
          </div>
          <div style={{ fontSize: '13px', color: D.textSub, marginBottom: '8px' }}>
            {portalUser.email}
          </div>
          <span style={{
            fontSize: '11px', fontWeight: '800', textTransform: 'uppercase',
            letterSpacing: '0.6px', padding: '3px 10px', borderRadius: '20px',
            backgroundColor: rc.bg, color: rc.text,
          }}>
            {portalUser.role}
          </span>
        </div>
        <div style={{ fontSize: '11px', color: D.textMuted, textAlign: 'right' }}>
          <div>Member since</div>
          <div style={{ fontWeight: '600', color: D.textSub }}>
            {new Date(portalUser.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          </div>
        </div>
      </div>

      {/* ── Edit profile ───────────────────────────────────────────── */}
      <div style={{ ...card({ marginBottom: '20px' }) }}>
        <div style={{ fontSize: '13px', fontWeight: '800', color: D.text, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '18px' }}>
          {t('profile.title')}
        </div>

        {profileError && (
          <div style={{ padding: '10px 14px', borderRadius: '8px', backgroundColor: D.errorBg, color: D.errorText, fontSize: '13px', fontWeight: '600', marginBottom: '16px', border: `1px solid ${D.errorText}22` }}>
            {profileError}
          </div>
        )}
        {profileSuccess && (
          <div style={{ padding: '10px 14px', borderRadius: '8px', backgroundColor: D.accentLight, color: D.accentText, fontSize: '13px', fontWeight: '600', marginBottom: '16px', border: `1px solid ${D.accent}44` }}>
            ✓ {profileSuccess}
          </div>
        )}

        <Form method="post">
          <input type="hidden" name="intent" value="updateProfile" />
          <div style={{ display: 'grid', gap: '16px' }}>
            <div>
              <span style={label('Name')}>Full name</span>
              <input
                name="name"
                type="text"
                defaultValue={portalUser.name}
                placeholder="Your name"
                style={inputStyle}
                required
              />
            </div>
            <div>
              <span style={label('Email')}>Email address</span>
              <input
                name="email"
                type="email"
                defaultValue={portalUser.email}
                placeholder="you@example.com"
                style={inputStyle}
                required
              />
            </div>
            <div>
              <button
                type="submit"
                disabled={isSubmitting && pendingIntent === 'updateProfile'}
                style={{
                  padding: '10px 22px', borderRadius: '8px', border: 'none',
                  cursor: 'pointer', fontSize: '13px', fontWeight: '700',
                  background: `linear-gradient(135deg, ${D.accent}, ${D.accentHover})`,
                  color: '#0D0F14',
                  opacity: (isSubmitting && pendingIntent === 'updateProfile') ? 0.6 : 1,
                }}
              >
                {isSubmitting && pendingIntent === 'updateProfile' ? t('profile.saving') : t('profile.save')}
              </button>
            </div>
          </div>
        </Form>
      </div>

      {/* ── Change password ────────────────────────────────────────── */}
      <div style={card()}>
        <div style={{ fontSize: '13px', fontWeight: '800', color: D.text, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '18px' }}>
          {t('profile.password.title')}
        </div>

        {passwordError && (
          <div style={{ padding: '10px 14px', borderRadius: '8px', backgroundColor: D.errorBg, color: D.errorText, fontSize: '13px', fontWeight: '600', marginBottom: '16px', border: `1px solid ${D.errorText}22` }}>
            {passwordError}
          </div>
        )}
        {passwordSuccess && (
          <div style={{ padding: '10px 14px', borderRadius: '8px', backgroundColor: D.accentLight, color: D.accentText, fontSize: '13px', fontWeight: '600', marginBottom: '16px', border: `1px solid ${D.accent}44` }}>
            ✓ {passwordSuccess}
          </div>
        )}

        <Form method="post">
          <input type="hidden" name="intent" value="changePassword" />
          <div style={{ display: 'grid', gap: '16px' }}>

            <div>
              <span style={label('Current')}>Current password</span>
              <div style={{ position: 'relative' }}>
                <input
                  name="currentPassword"
                  type={showCurrentPw ? 'text' : 'password'}
                  placeholder="Enter current password"
                  style={{ ...inputStyle, paddingRight: '44px' }}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPw(v => !v)}
                  style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: D.textMuted, padding: 0, lineHeight: 1 }}
                >
                  {showCurrentPw ? '🙈' : '👁'}
                </button>
              </div>
            </div>

            <div>
              <span style={label('New')}>New password</span>
              <div style={{ position: 'relative' }}>
                <input
                  name="newPassword"
                  type={showNewPw ? 'text' : 'password'}
                  placeholder="At least 8 characters"
                  style={{ ...inputStyle, paddingRight: '44px' }}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPw(v => !v)}
                  style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: D.textMuted, padding: 0, lineHeight: 1 }}
                >
                  {showNewPw ? '🙈' : '👁'}
                </button>
              </div>
            </div>

            <div>
              <span style={label('Confirm')}>Confirm new password</span>
              <input
                name="confirmPassword"
                type="password"
                placeholder="Repeat new password"
                style={inputStyle}
                autoComplete="new-password"
              />
            </div>

            <div>
              <button
                type="submit"
                disabled={isSubmitting && pendingIntent === 'changePassword'}
                style={{
                  padding: '10px 22px', borderRadius: '8px', border: `1px solid ${D.border}`,
                  cursor: 'pointer', fontSize: '13px', fontWeight: '700',
                  backgroundColor: D.surfaceHigh, color: D.text,
                  opacity: (isSubmitting && pendingIntent === 'changePassword') ? 0.6 : 1,
                }}
              >
                {isSubmitting && pendingIntent === 'changePassword' ? t('profile.password.updating') : t('profile.password.update')}
              </button>
            </div>
          </div>
        </Form>
      </div>

    </div>
  );
}
