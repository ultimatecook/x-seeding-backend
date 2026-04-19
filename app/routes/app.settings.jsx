import { useState } from 'react';
import { Form, useLoaderData, useActionData, useRouteError, useRouteLoaderData } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import { authenticate } from '../shopify.server';
import { generateInviteToken } from '../utils/portal-auth.server';
import { sendInviteEmail } from '../utils/email.server';
import prisma from '../db.server';

const P = {
  accent:      '#7C6FF7',
  accentFaint: '#F4F2FF',
  border:      '#E5E3F0',
  borderLight: '#F0EEF8',
  bg:          '#F7F6FB',
  surface:     '#FFFFFF',
  surfaceHigh: '#F3F2F8',
  text:        '#1A1523',
  textSub:     '#6B6880',
  textMuted:   '#A09CB8',
  errorText:   '#DC2626',
  shadow:      '0 1px 4px rgba(124,111,247,0.08), 0 4px 16px rgba(0,0,0,0.04)',
};

const btnPrimary = {
  backgroundColor: P.accent, color: '#fff',
  border: 'none', borderRadius: '8px',
  padding: '8px 16px', fontSize: '13px', fontWeight: '700',
  cursor: 'pointer',
};
const btnSecondary = {
  backgroundColor: 'transparent', color: P.textSub,
  border: `1px solid ${P.border}`, borderRadius: '8px',
  padding: '7px 14px', fontSize: '12px', fontWeight: '600',
  cursor: 'pointer',
};
const inputBase = {
  width: '100%', boxSizing: 'border-box',
  padding: '8px 12px', fontSize: '13px',
  border: `1px solid ${P.border}`, borderRadius: '8px',
  backgroundColor: P.surface, color: P.text,
  outline: 'none',
};

const ROLES = ['Owner', 'Editor', 'Viewer'];
const ROLE_DESC = {
  Owner:  'Full access including team management.',
  Editor: 'Can create and edit seedings, campaigns, influencers.',
  Viewer: 'Read-only access.',
};
const ROLE_BADGE = {
  Owner:  { bg: '#EDE9FE', color: '#5B21B6' },
  Editor: { bg: '#DBEAFE', color: '#1D4ED8' },
  Viewer: { bg: P.surfaceHigh, color: P.textSub },
};

const APP_URL = process.env.SHOPIFY_APP_URL || 'https://zeedy.xyz';

// ── Loader ────────────────────────────────────────────────────────────────────
export async function loader({ request }) {
  console.log('[settings] loader start', request.method, request.url);
  let session, admin;
  try {
    ({ session, admin } = await authenticate.admin(request));
    console.log('[settings] auth ok, shop=', session?.shop);
  } catch (e) {
    console.error('[settings] auth failed:', e?.message, e?.status);
    throw e;
  }
  const shop = session.shop;

  // Fetch owner email from Shopify Admin API (not on session object)
  let ownerEmail = null;
  let ownerName  = 'Store Owner';
  try {
    const resp = await admin.graphql(`{ shop { email name } }`);
    const { data } = await resp.json();
    ownerEmail = data?.shop?.email?.toLowerCase().trim() || null;
    ownerName  = data?.shop?.name || 'Store Owner';
  } catch (_) {}

  // Auto-provision Owner account for the Shopify store owner on first visit
  let ownerSetup = null;

  if (ownerEmail) {
    try {
      const existing = await prisma.portalUser.findUnique({
        where: { shop_email: { shop, email: ownerEmail } },
      });
      if (!existing) {
        const token   = generateInviteToken();
        const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await prisma.portalUser.create({
          data: { shop, email: ownerEmail, name: ownerName, role: 'Owner', inviteToken: token, inviteExpires: expires },
        });
        ownerSetup = { inviteUrl: `${APP_URL}/portal-accept-invite?token=${token}`, email: ownerEmail, isNew: true };
      } else if (!existing.acceptedAt) {
        const token   = generateInviteToken();
        const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await prisma.portalUser.update({ where: { id: existing.id }, data: { inviteToken: token, inviteExpires: expires } });
        ownerSetup = { inviteUrl: `${APP_URL}/portal-accept-invite?token=${token}`, email: ownerEmail, isNew: false };
      }
    } catch (e) {
      console.error('[settings] portalUser provision error:', e?.message);
    }
  }

  let users = [];
  try {
    users = await prisma.portalUser.findMany({
      where:   { shop },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
  } catch (e) {
    console.error('[settings] portalUser findMany error:', e?.message);
  }

  console.log('[settings] loader done, users=', users.length);
  return { users, ownerSetup, ownerEmail };
}

// ── Action ────────────────────────────────────────────────────────────────────
export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent   = formData.get('intent');

  if (intent === 'invite') {
    const email = String(formData.get('email') || '').toLowerCase().trim();
    const name  = String(formData.get('name')  || '').trim();
    const role  = String(formData.get('role')  || 'Editor');
    if (!email || !name)       return { error: 'Name and email are required.' };
    if (!ROLES.includes(role)) return { error: 'Invalid role.' };

    const token   = generateInviteToken();
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    try {
      await prisma.portalUser.upsert({
        where:  { shop_email: { shop, email } },
        update: { name, role, inviteToken: token, inviteExpires: expires, acceptedAt: null, passwordHash: null },
        create: { shop, email, name, role, inviteToken: token, inviteExpires: expires },
      });
    } catch (e) {
      return { error: 'Could not create invite: ' + e.message };
    }
    const inviteUrl = `${APP_URL}/portal-accept-invite?token=${token}`;
    sendInviteEmail({ to: email, name, inviteUrl }).catch(() => {});
    return { inviteUrl, invitedEmail: email, invitedName: name };
  }

  if (intent === 'resend') {
    const id  = parseInt(formData.get('userId'));
    const row = await prisma.portalUser.findUnique({ where: { id } });
    if (!row || row.shop !== shop) return { error: 'User not found.' };
    const token   = generateInviteToken();
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.portalUser.update({ where: { id }, data: { inviteToken: token, inviteExpires: expires } });
    const inviteUrl = `${APP_URL}/portal-accept-invite?token=${token}`;
    sendInviteEmail({ to: row.email, name: row.name, inviteUrl }).catch(() => {});
    return { inviteUrl, invitedEmail: row.email, invitedName: row.name };
  }

  if (intent === 'updateRole') {
    const id   = parseInt(formData.get('userId'));
    const role = String(formData.get('role') || '');
    if (!ROLES.includes(role)) return null;
    const row = await prisma.portalUser.findUnique({ where: { id } });
    if (!row || row.shop !== shop) return null;
    await prisma.portalUser.update({ where: { id }, data: { role } });
    return null;
  }

  if (intent === 'revoke') {
    const id  = parseInt(formData.get('userId'));
    const row = await prisma.portalUser.findUnique({ where: { id } });
    if (!row || row.shop !== shop) return null;
    await prisma.portalUser.delete({ where: { id } });
    return null;
  }

  return null;
}

// ── Sub-components ────────────────────────────────────────────────────────────
function RoleBadge({ role }) {
  const s = ROLE_BADGE[role] || ROLE_BADGE.Viewer;
  return (
    <span style={{ fontSize: '10px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px',
      backgroundColor: s.bg, color: s.color, borderRadius: '20px', padding: '2px 8px', flexShrink: 0 }}>
      {role}
    </span>
  );
}

function SectionHeader({ children, count }) {
  return (
    <div style={{ padding: '14px 20px', borderBottom: `1px solid ${P.border}`,
      fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.8px', color: P.textMuted }}>
      {children}{count != null && <span style={{ marginLeft: '6px', fontWeight: '600' }}>({count})</span>}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function AppSettings() {
  const { users, ownerSetup, ownerEmail } = useLoaderData();
  const actionData = useActionData();

  const [showForm, setShowForm] = useState(false);

  const inviteUrl = actionData?.inviteUrl;

  const active  = users.filter(u =>  u.acceptedAt);
  const pending = users.filter(u => !u.acceptedAt);

  return (
    <div style={{ maxWidth: '700px', margin: '0 auto', padding: '32px 24px', display: 'grid', gap: '24px' }}>

      {/* Title */}
      <div>
        <h2 style={{ margin: '0 0 4px', fontSize: '20px', fontWeight: '800', color: P.text, letterSpacing: '-0.3px' }}>
          Team &amp; Access
        </h2>
        <p style={{ margin: 0, fontSize: '13px', color: P.textMuted }}>
          Manage who can log into the Zeedy portal at{' '}
          <a href={`${APP_URL}/portal`} target="_blank" rel="noreferrer"
            style={{ color: P.accent, fontWeight: '600', textDecoration: 'none' }}>
            zeedy.xyz/portal
          </a>
        </p>
      </div>

      {/* ── Owner setup banner ──────────────────────────────── */}
      {ownerSetup && (
        <div style={{ backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '14px', padding: '20px 24px' }}>
          <div style={{ fontSize: '14px', fontWeight: '800', color: '#92400E', marginBottom: '6px' }}>
            {ownerSetup.isNew ? '👋 Set up your portal login' : '⚠️ Portal login not yet activated'}
          </div>
          <p style={{ margin: '0 0 14px', fontSize: '13px', color: '#B45309', lineHeight: 1.6 }}>
            {ownerSetup.isNew
              ? <>An Owner account has been created for <strong>{ownerSetup.email}</strong>. Click below to set your password.</>
              : <>Your portal account (<strong>{ownerSetup.email}</strong>) exists but no password has been set yet.</>
            }
          </p>
          <a href={ownerSetup.inviteUrl} target="_blank" rel="noreferrer"
            style={{ ...btnPrimary, backgroundColor: '#D97706', textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
            Set up portal login →
          </a>
          <div style={{ fontSize: '11px', fontWeight: '700', color: '#92400E', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Or copy manually:
          </div>
          <input
            type="text"
            readOnly
            value={ownerSetup.inviteUrl}
            onClick={e => e.target.select()}
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '7px 10px', fontSize: '11px',
              border: '1px solid #FDE68A', borderRadius: '6px',
              backgroundColor: '#FFFDE7', color: '#92400E',
              fontFamily: 'monospace', cursor: 'text',
            }}
          />
        </div>
      )}

      {/* ── Invite card ─────────────────────────────────────── */}
      <div style={{ backgroundColor: P.surface, border: `1px solid ${P.border}`,
        borderRadius: '14px', overflow: 'hidden', boxShadow: P.shadow }}>

        <div style={{ padding: '18px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          borderBottom: showForm || inviteUrl || actionData?.error ? `1px solid ${P.border}` : 'none' }}>
          <div>
            <div style={{ fontSize: '14px', fontWeight: '700', color: P.text }}>Invite a team member</div>
            <div style={{ fontSize: '12px', color: P.textMuted, marginTop: '2px' }}>
              Generates a setup link you share with them directly.
            </div>
          </div>
          <button type="button" onClick={() => setShowForm(v => !v)} style={{ ...btnPrimary, flexShrink: 0 }}>
            {showForm ? 'Cancel' : '+ Invite'}
          </button>
        </div>

        {/* Generated link */}
        {inviteUrl && (
          <div style={{ padding: '16px 20px', backgroundColor: '#F0FDF4', borderBottom: `1px solid #BBF7D0` }}>
            <div style={{ fontSize: '13px', fontWeight: '700', color: '#065F46', marginBottom: '4px' }}>
              ✓ Invite created for {actionData.invitedName}
            </div>
            <div style={{ fontSize: '12px', color: '#065F46', marginBottom: '10px' }}>
              Share this link — expires in 7 days:
            </div>
            <input
              type="text"
              readOnly
              value={inviteUrl}
              onClick={e => e.target.select()}
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '7px 10px', fontSize: '11px',
                border: '1px solid #BBF7D0', borderRadius: '6px',
                backgroundColor: '#DCFCE7', color: '#065F46',
                fontFamily: 'monospace', cursor: 'text',
              }}
            />
          </div>
        )}

        {/* Error */}
        {actionData?.error && (
          <div style={{ padding: '12px 20px', backgroundColor: '#FEF2F2', color: P.errorText,
            fontSize: '13px', fontWeight: '600', borderBottom: `1px solid #FECACA` }}>
            {actionData.error}
          </div>
        )}

        {/* Invite form */}
        {showForm && (
          <Form method="post" style={{ padding: '20px' }} onSubmit={() => setShowForm(false)}>
            <input type="hidden" name="intent" value="invite" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '16px' }}>
              <div>
                <label style={{ fontSize: '11px', fontWeight: '700', color: P.textMuted, textTransform: 'uppercase',
                  letterSpacing: '0.6px', display: 'block', marginBottom: '6px' }}>Full Name *</label>
                <input name="name" type="text" required placeholder="Jane Smith" autoFocus style={inputBase} />
              </div>
              <div>
                <label style={{ fontSize: '11px', fontWeight: '700', color: P.textMuted, textTransform: 'uppercase',
                  letterSpacing: '0.6px', display: 'block', marginBottom: '6px' }}>Email *</label>
                <input name="email" type="email" required placeholder="jane@brand.com" style={inputBase} />
              </div>
            </div>
            <div style={{ marginBottom: '18px' }}>
              <label style={{ fontSize: '11px', fontWeight: '700', color: P.textMuted, textTransform: 'uppercase',
                letterSpacing: '0.6px', display: 'block', marginBottom: '8px' }}>Role</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                {ROLES.map(r => (
                  <label key={r} style={{ display: 'flex', flexDirection: 'column', gap: '4px',
                    padding: '10px 14px', border: `1px solid ${P.border}`, borderRadius: '8px', cursor: 'pointer' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px',
                      fontSize: '13px', fontWeight: '700', color: P.text }}>
                      <input type="radio" name="role" value={r} defaultChecked={r === 'Editor'}
                        style={{ accentColor: P.accent }} />
                      {r}
                    </div>
                    <div style={{ fontSize: '11px', color: P.textMuted, lineHeight: 1.4, paddingLeft: '20px' }}>
                      {ROLE_DESC[r]}
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="submit" style={{ ...btnPrimary, padding: '9px 22px' }}>
                Generate invite link
              </button>
            </div>
          </Form>
        )}
      </div>

      {/* ── Active members ──────────────────────────────────── */}
      <div style={{ backgroundColor: P.surface, border: `1px solid ${P.border}`,
        borderRadius: '14px', overflow: 'hidden', boxShadow: P.shadow }}>
        <SectionHeader count={active.length}>Active Members</SectionHeader>
        {active.length === 0 ? (
          <div style={{ padding: '20px', fontSize: '13px', color: P.textMuted }}>No active members yet.</div>
        ) : active.map((user, i) => (
          <div key={user.id} style={{
            display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center',
            gap: '12px', padding: '14px 20px',
            borderTop: i > 0 ? `1px solid ${P.borderLight}` : 'none',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '50%', backgroundColor: P.accentFaint,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '14px', fontWeight: '800', color: P.accent, flexShrink: 0 }}>
                {user.name?.charAt(0).toUpperCase() || '?'}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: '700', color: P.text,
                  display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' }}>
                  {user.name}
                  {user.email === ownerEmail && (
                    <span style={{ fontSize: '10px', color: P.textMuted, fontWeight: '600' }}>(you)</span>
                  )}
                  <RoleBadge role={user.role} />
                </div>
                <div style={{ fontSize: '12px', color: P.textMuted, marginTop: '2px',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user.email}
                </div>
              </div>
            </div>
            {user.email !== ownerEmail && (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
                <Form method="post">
                  <input type="hidden" name="intent" value="updateRole" />
                  <input type="hidden" name="userId" value={user.id} />
                  <select name="role" defaultValue={user.role} onChange={e => e.target.form.requestSubmit()}
                    style={{ ...inputBase, width: 'auto', padding: '5px 8px', fontSize: '12px' }}>
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </Form>
                <Form method="post"
                  onSubmit={e => { if (!confirm(`Remove ${user.name}?`)) e.preventDefault(); }}>
                  <input type="hidden" name="intent" value="revoke" />
                  <input type="hidden" name="userId" value={user.id} />
                  <button type="submit" title="Remove"
                    style={{ background: 'none', border: 'none', color: P.textMuted,
                      cursor: 'pointer', fontSize: '20px', lineHeight: 1, padding: '2px 4px' }}>
                    ×
                  </button>
                </Form>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── Pending invites ─────────────────────────────────── */}
      {pending.length > 0 && (
        <div style={{ backgroundColor: P.surface, border: `1px solid ${P.border}`,
          borderRadius: '14px', overflow: 'hidden', boxShadow: P.shadow }}>
          <SectionHeader count={pending.length}>Pending Invites</SectionHeader>
          {pending.map((user, i) => (
            <div key={user.id} style={{
              display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center',
              gap: '12px', padding: '14px 20px',
              borderTop: i > 0 ? `1px solid ${P.borderLight}` : 'none',
            }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: '700', color: P.textSub,
                  display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' }}>
                  {user.name}
                  <RoleBadge role={user.role} />
                  <span style={{ fontSize: '10px', fontWeight: '700', backgroundColor: '#FEF3C7',
                    color: '#92400E', borderRadius: '20px', padding: '2px 8px' }}>Pending</span>
                </div>
                <div style={{ fontSize: '12px', color: P.textMuted, marginTop: '2px', display: 'flex', gap: '10px' }}>
                  <span>{user.email}</span>
                  {user.inviteExpires && (
                    <span style={{ color: new Date() > new Date(user.inviteExpires) ? P.errorText : P.textMuted }}>
                      · expires {new Date(user.inviteExpires).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                <Form method="post">
                  <input type="hidden" name="intent" value="resend" />
                  <input type="hidden" name="userId" value={user.id} />
                  <button type="submit" style={btnSecondary}>Resend</button>
                </Form>
                <Form method="post"
                  onSubmit={e => { if (!confirm(`Cancel invite for ${user.name}?`)) e.preventDefault(); }}>
                  <input type="hidden" name="intent" value="revoke" />
                  <input type="hidden" name="userId" value={user.id} />
                  <button type="submit" title="Cancel invite"
                    style={{ background: 'none', border: 'none', color: P.textMuted,
                      cursor: 'pointer', fontSize: '20px', lineHeight: 1, padding: '2px 4px' }}>
                    ×
                  </button>
                </Form>
              </div>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
