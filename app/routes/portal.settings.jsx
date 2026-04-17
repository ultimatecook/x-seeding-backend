import { useState } from 'react';
import { Form, useLoaderData, useActionData } from 'react-router';
import prisma from '../db.server';
import { requirePortalUser, generateInviteToken } from '../utils/portal-auth.server';
import { can, requirePermission } from '../utils/portal-permissions';
import { audit } from '../utils/audit.server.js';
import { D, Pbtn as btn, Pinput as input } from '../utils/portal-theme';

const ROLES = ['Owner', 'Editor', 'Viewer'];

// ── Loader ────────────────────────────────────────────────────────────────────
export async function loader({ request }) {
  const { shop, portalUser } = await requirePortalUser(request);
  requirePermission(portalUser.role, 'manageUsers');

  const users = await prisma.portalUser.findMany({
    where:   { shop },
    orderBy: [{ createdAt: 'asc' }],
  });

  return { users, currentUserId: portalUser.id };
}

// ── Action ────────────────────────────────────────────────────────────────────
export async function action({ request }) {
  const { shop, portalUser } = await requirePortalUser(request);
  requirePermission(portalUser.role, 'manageUsers');

  const formData = await request.formData();
  const intent   = formData.get('intent');

  // ── Invite ──────────────────────────────────────────────────────────────
  if (intent === 'invite') {
    const email = String(formData.get('email') || '').toLowerCase().trim();
    const name  = String(formData.get('name')  || '').trim();
    const role  = String(formData.get('role')  || 'Viewer');

    if (!email || !name)     return { error: 'Name and email are required.' };
    if (!ROLES.includes(role)) return { error: 'Invalid role.' };

    // Prevent inviting yourself or demoting yourself accidentally
    if (email === portalUser.email) return { error: 'You cannot invite yourself.' };

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

    const base      = process.env.SHOPIFY_APP_URL || 'https://zeedy.xyz';
    const inviteUrl = `${base}/portal-accept-invite?token=${token}`;
    await audit({ shop, portalUser, action: 'invited_user', entityType: 'portalUser', entityId: null, detail: `Invited ${name} (${email}) as ${role}` });
    return { inviteUrl, invitedEmail: email, invitedName: name };
  }

  // ── Resend invite ────────────────────────────────────────────────────────
  if (intent === 'resend') {
    const id = parseInt(formData.get('userId'));
    const existing = await prisma.portalUser.findUnique({ where: { id }, select: { shop: true, email: true, name: true, role: true, acceptedAt: true } });
    if (!existing || existing.shop !== shop) return { error: 'User not found.' };
    if (existing.acceptedAt) return { error: 'User has already accepted their invite.' };

    const token   = generateInviteToken();
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.portalUser.update({ where: { id }, data: { inviteToken: token, inviteExpires: expires } });

    const base      = process.env.SHOPIFY_APP_URL || 'https://zeedy.xyz';
    const inviteUrl = `${base}/portal-accept-invite?token=${token}`;
    await audit({ shop, portalUser, action: 'resent_invite', entityType: 'portalUser', entityId: id, detail: `Resent invite to ${existing.email}` });
    return { inviteUrl, invitedEmail: existing.email, invitedName: existing.name };
  }

  // ── Update role ──────────────────────────────────────────────────────────
  if (intent === 'updateRole') {
    const id   = parseInt(formData.get('userId'));
    const role = String(formData.get('role') || '');
    if (!ROLES.includes(role)) return { error: 'Invalid role.' };
    if (id === portalUser.id)  return { error: 'You cannot change your own role.' };

    const existing = await prisma.portalUser.findUnique({ where: { id }, select: { shop: true, email: true, name: true } });
    if (!existing || existing.shop !== shop) return { error: 'User not found.' };

    await prisma.portalUser.update({ where: { id }, data: { role } });
    await audit({ shop, portalUser, action: 'updated_user_role', entityType: 'portalUser', entityId: id, detail: `Set ${existing.name} (${existing.email}) role to ${role}` });
    return null;
  }

  // ── Revoke / delete ──────────────────────────────────────────────────────
  if (intent === 'revoke') {
    const id = parseInt(formData.get('userId'));
    if (id === portalUser.id) return { error: 'You cannot remove yourself.' };

    const existing = await prisma.portalUser.findUnique({ where: { id }, select: { shop: true, email: true, name: true } });
    if (!existing || existing.shop !== shop) return { error: 'User not found.' };

    await prisma.portalUser.delete({ where: { id } });
    await audit({ shop, portalUser, action: 'removed_user', entityType: 'portalUser', entityId: id, detail: `Removed ${existing.name} (${existing.email})` });
    return null;
  }

  return null;
}

// ── Role badge ────────────────────────────────────────────────────────────────
const ROLE_STYLE = {
  Owner:  { bg: '#EDE9FE', color: '#5B21B6' },
  Editor: { bg: '#DBEAFE', color: '#1D4ED8' },
  Viewer: { bg: D.surfaceHigh, color: D.textSub },
};

function RoleBadge({ role }) {
  const s = ROLE_STYLE[role] || ROLE_STYLE.Viewer;
  return (
    <span style={{ fontSize: '10px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px',
      backgroundColor: s.bg, color: s.color, borderRadius: '20px', padding: '2px 8px' }}>
      {role}
    </span>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function PortalSettings() {
  const { users, currentUserId } = useLoaderData();
  const actionData = useActionData();

  const [showForm, setShowForm]   = useState(false);
  const [copied,   setCopied]     = useState(false);

  function copyUrl() {
    if (actionData?.inviteUrl) {
      navigator.clipboard.writeText(actionData.inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  const pending  = users.filter(u => !u.acceptedAt);
  const accepted = users.filter(u =>  u.acceptedAt);

  return (
    <div style={{ display: 'grid', gap: '24px', maxWidth: '680px' }}>

      {/* Header */}
      <div>
        <h2 style={{ margin: '0 0 4px', fontSize: '18px', fontWeight: '800', color: D.text, letterSpacing: '-0.3px' }}>
          Team &amp; Access
        </h2>
        <p style={{ margin: 0, fontSize: '13px', color: D.textMuted }}>
          Invite team members and manage their portal access.
        </p>
      </div>

      {/* Invite form card */}
      <div style={{ backgroundColor: D.surface, border: `1px solid ${D.border}`, borderRadius: '14px', overflow: 'hidden', boxShadow: D.shadow }}>
        <div style={{ padding: '18px 20px', borderBottom: showForm || actionData?.inviteUrl ? `1px solid ${D.border}` : 'none',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '13px', fontWeight: '700', color: D.text }}>Invite a team member</span>
          <button type="button" onClick={() => setShowForm(v => !v)}
            style={{ ...btn.primary, padding: '7px 16px', fontSize: '12px' }}>
            {showForm ? 'Cancel' : '+ Invite'}
          </button>
        </div>

        {/* Generated invite link */}
        {actionData?.inviteUrl && (
          <div style={{ padding: '16px 20px', backgroundColor: '#F0FDF4', borderBottom: `1px solid #BBF7D0` }}>
            <div style={{ fontSize: '13px', fontWeight: '700', color: '#065F46', marginBottom: '4px' }}>
              ✓ Invite link created for {actionData.invitedName}
            </div>
            <div style={{ fontSize: '12px', color: '#065F46', marginBottom: '10px' }}>
              Share this link — it expires in 7 days:
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <code style={{ fontSize: '11px', backgroundColor: '#DCFCE7', padding: '7px 10px', borderRadius: '6px',
                flex: 1, wordBreak: 'break-all', color: '#065F46', border: '1px solid #BBF7D0' }}>
                {actionData.inviteUrl}
              </code>
              <button type="button" onClick={copyUrl}
                style={{ ...btn.primary, fontSize: '12px', padding: '7px 14px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                {copied ? '✓ Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {actionData?.error && (
          <div style={{ padding: '12px 20px', backgroundColor: '#FEF2F2', color: '#DC2626', fontSize: '13px', fontWeight: '600', borderBottom: `1px solid #FECACA` }}>
            {actionData.error}
          </div>
        )}

        {/* Form */}
        {showForm && (
          <Form method="post" style={{ padding: '20px' }} onSubmit={() => setShowForm(false)}>
            <input type="hidden" name="intent" value="invite" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
              <div>
                <label style={{ fontSize: '11px', fontWeight: '700', color: D.textMuted, textTransform: 'uppercase', letterSpacing: '0.6px', display: 'block', marginBottom: '6px' }}>
                  Full Name *
                </label>
                <input name="name" type="text" required placeholder="Jane Smith" autoFocus
                  style={{ ...input.base, width: '100%', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: '11px', fontWeight: '700', color: D.textMuted, textTransform: 'uppercase', letterSpacing: '0.6px', display: 'block', marginBottom: '6px' }}>
                  Email *
                </label>
                <input name="email" type="email" required placeholder="jane@brand.com"
                  style={{ ...input.base, width: '100%', boxSizing: 'border-box' }} />
              </div>
            </div>
            <div style={{ marginBottom: '18px' }}>
              <label style={{ fontSize: '11px', fontWeight: '700', color: D.textMuted, textTransform: 'uppercase', letterSpacing: '0.6px', display: 'block', marginBottom: '6px' }}>
                Role
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {ROLES.map(r => (
                  <label key={r} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px',
                    border: `1px solid ${D.border}`, borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '600', color: D.textSub }}>
                    <input type="radio" name="role" value={r} defaultChecked={r === 'Editor'}
                      style={{ accentColor: D.accent }} />
                    {r}
                  </label>
                ))}
              </div>
              <div style={{ marginTop: '8px', fontSize: '12px', color: D.textMuted, lineHeight: 1.5 }}>
                <strong style={{ color: D.textSub }}>Owner</strong> — full access incl. team management ·{' '}
                <strong style={{ color: D.textSub }}>Editor</strong> — create/edit seedings, influencers, campaigns ·{' '}
                <strong style={{ color: D.textSub }}>Viewer</strong> — read-only
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="submit" style={{ ...btn.primary, padding: '9px 22px', fontSize: '13px' }}>
                Generate invite link
              </button>
            </div>
          </Form>
        )}
      </div>

      {/* Active members */}
      <div style={{ backgroundColor: D.surface, border: `1px solid ${D.border}`, borderRadius: '14px', overflow: 'hidden', boxShadow: D.shadow }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${D.border}` }}>
          <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.8px', color: D.textMuted }}>
            Active Members ({accepted.length})
          </span>
        </div>
        {accepted.length === 0 ? (
          <div style={{ padding: '24px 20px', color: D.textMuted, fontSize: '13px' }}>No active members yet.</div>
        ) : (
          <div>
            {accepted.map((user, i) => (
              <div key={user.id} style={{
                display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: '12px',
                padding: '14px 20px', borderTop: i > 0 ? `1px solid ${D.borderLight}` : 'none',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '34px', height: '34px', borderRadius: '50%', backgroundColor: D.accentFaint,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '14px', fontWeight: '800', color: D.accent, flexShrink: 0 }}>
                    {user.name?.charAt(0).toUpperCase() || '?'}
                  </div>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: '700', color: D.text, display: 'flex', alignItems: 'center', gap: '7px' }}>
                      {user.name}
                      {user.id === currentUserId && <span style={{ fontSize: '10px', color: D.textMuted, fontWeight: '600' }}>(you)</span>}
                      <RoleBadge role={user.role} />
                    </div>
                    <div style={{ fontSize: '12px', color: D.textMuted, marginTop: '2px' }}>{user.email}</div>
                  </div>
                </div>

                {user.id !== currentUserId && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Form method="post" style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <input type="hidden" name="intent"  value="updateRole" />
                      <input type="hidden" name="userId"  value={user.id} />
                      <select name="role" defaultValue={user.role}
                        onChange={e => e.target.form.requestSubmit()}
                        style={{ ...input.base, fontSize: '12px', padding: '5px 8px', minWidth: '90px' }}>
                        {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </Form>
                    <Form method="post" onSubmit={e => { if (!confirm(`Remove ${user.name} from the portal?`)) e.preventDefault(); }}>
                      <input type="hidden" name="intent" value="revoke" />
                      <input type="hidden" name="userId" value={user.id} />
                      <button type="submit" title="Remove"
                        style={{ background: 'none', border: 'none', color: D.textMuted, cursor: 'pointer', fontSize: '19px', lineHeight: 1, padding: '2px 4px' }}>
                        ×
                      </button>
                    </Form>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pending invites */}
      {pending.length > 0 && (
        <div style={{ backgroundColor: D.surface, border: `1px solid ${D.border}`, borderRadius: '14px', overflow: 'hidden', boxShadow: D.shadow }}>
          <div style={{ padding: '16px 20px', borderBottom: `1px solid ${D.border}` }}>
            <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.8px', color: D.textMuted }}>
              Pending Invites ({pending.length})
            </span>
          </div>
          <div>
            {pending.map((user, i) => (
              <div key={user.id} style={{
                display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: '12px',
                padding: '14px 20px', borderTop: i > 0 ? `1px solid ${D.borderLight}` : 'none',
              }}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: D.textSub, display: 'flex', alignItems: 'center', gap: '7px' }}>
                    {user.name}
                    <RoleBadge role={user.role} />
                    <span style={{ fontSize: '10px', fontWeight: '700', backgroundColor: '#FEF3C7', color: '#92400E', borderRadius: '20px', padding: '2px 8px' }}>
                      Pending
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: D.textMuted, marginTop: '2px' }}>
                    {user.email}
                    {user.inviteExpires && (
                      <span style={{ marginLeft: '8px', color: new Date() > new Date(user.inviteExpires) ? '#DC2626' : D.textMuted }}>
                        · expires {new Date(user.inviteExpires).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <Form method="post">
                    <input type="hidden" name="intent" value="resend" />
                    <input type="hidden" name="userId" value={user.id} />
                    <button type="submit"
                      style={{ padding: '6px 12px', borderRadius: '7px', border: `1px solid ${D.border}`,
                        backgroundColor: 'transparent', color: D.textSub, cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
                      Resend
                    </button>
                  </Form>
                  <Form method="post" onSubmit={e => { if (!confirm(`Cancel invite for ${user.name}?`)) e.preventDefault(); }}>
                    <input type="hidden" name="intent" value="revoke" />
                    <input type="hidden" name="userId" value={user.id} />
                    <button type="submit" title="Cancel invite"
                      style={{ background: 'none', border: 'none', color: D.textMuted, cursor: 'pointer', fontSize: '19px', lineHeight: 1, padding: '2px 4px' }}>
                      ×
                    </button>
                  </Form>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
