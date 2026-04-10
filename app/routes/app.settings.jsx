import { useState } from 'react';
import { Form, useLoaderData, useRouteLoaderData, useRouteError, useActionData } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import prisma from '../db.server';
import { generateInviteToken } from '../utils/portal-auth.server';
import { C, btn, card, input, section } from '../theme';

const ROLES = ['Owner', 'Editor', 'Viewer'];

export async function loader() {
  let members = [];
  try {
    const memberships = await prisma.appMembership.findMany({
      include: { user: true },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
    members = memberships.map(m => ({
      id:             m.id,
      shop:           m.shop,
      role:           m.role,
      userId:         m.userId,
      email:          m.user.email,
      firstName:      m.user.firstName,
      lastName:       m.user.lastName,
      isShopifyOwner: m.user.isShopifyOwner,
    }));
  } catch (e) {
    console.warn('Settings: RBAC tables not yet migrated —', e.message);
  }

  let portalUsers = [];
  try {
    portalUsers = await prisma.portalUser.findMany({
      orderBy: [{ createdAt: 'asc' }],
    });
  } catch (e) {
    console.warn('Settings: portalUser table not yet migrated —', e.message);
  }

  return { members, portalUsers };
}

export async function action({ request }) {
  const formData = await request.formData();
  const intent   = formData.get('intent');

  if (intent === 'updateRole') {
    const membershipId = parseInt(formData.get('membershipId'));
    const role         = String(formData.get('role') || '');
    if (!membershipId || !ROLES.includes(role)) return null;
    try {
      await prisma.appMembership.update({
        where: { id: membershipId },
        data:  { role },
      });
    } catch (e) {
      console.warn('Settings action: RBAC tables not yet migrated —', e.message);
    }
    return null;
  }

  if (intent === 'invitePortalUser') {
    const email = String(formData.get('email') || '').toLowerCase().trim();
    const name  = String(formData.get('name')  || '').trim();
    const role  = String(formData.get('role')  || 'Viewer');
    const shop  = String(formData.get('shop')  || '');

    if (!email || !name || !shop) return { error: 'Email, name, and shop are required.' };
    if (!ROLES.includes(role))    return { error: 'Invalid role.' };

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

    const inviteUrl = `${process.env.SHOPIFY_APP_URL || ''}/portal-accept-invite?token=${token}`;
    return { inviteUrl, invitedEmail: email };
  }

  if (intent === 'revokePortalUser') {
    const id = parseInt(formData.get('portalUserId'));
    try {
      await prisma.portalUser.delete({ where: { id } });
    } catch (e) {
      console.warn('Could not delete portal user:', e.message);
    }
    return null;
  }

  return null;
}

export default function SettingsPage() {
  const { members: allMembers, portalUsers: allPortalUsers } = useLoaderData();
  const actionData = useActionData();
  const { shop }   = useRouteLoaderData('routes/app') ?? {};

  const members     = shop ? allMembers.filter(m => m.shop === shop) : allMembers;
  const portalUsers = shop ? allPortalUsers.filter(u => u.shop === shop) : allPortalUsers;

  const [showInviteForm, setShowInviteForm] = useState(false);
  const [copiedUrl,      setCopiedUrl]      = useState(false);

  function copyInviteUrl() {
    if (actionData?.inviteUrl) {
      navigator.clipboard.writeText(actionData.inviteUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    }
  }

  return (
    <div style={{ display: 'grid', gap: '20px', maxWidth: '680px' }}>
      <div style={card.base}>
        <h2 style={{ margin: '0 0 6px', color: C.text }}>Settings</h2>
        <p style={{ margin: 0, color: C.textSub, fontSize: '13px' }}>
          Manage team access to the seeding portal.
        </p>
      </div>

      {/* ── Portal Users ───────────────────────────────────── */}
      <section style={card.base}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, ...section.title }}>Portal Users</h3>
          <button type="button" onClick={() => setShowInviteForm(v => !v)}
            style={{ ...btn.primary, fontSize: '12px', padding: '6px 14px' }}>
            {showInviteForm ? 'Cancel' : '+ Invite user'}
          </button>
        </div>

        <p style={{ margin: '0 0 14px', fontSize: '13px', color: C.textSub }}>
          Portal users can access the app at{' '}
          <a href="/portal-login" target="_blank" rel="noopener noreferrer"
            style={{ color: C.accent, fontWeight: '700' }}>
            /portal-login
          </a>
          {' '}without needing a Shopify account.
        </p>

        {/* Invite form */}
        {showInviteForm && (
          <Form method="post" style={{ display: 'grid', gap: '10px', padding: '14px', backgroundColor: C.surfaceHigh, borderRadius: '8px', marginBottom: '16px', border: `1px solid ${C.borderLight}` }}>
            <input type="hidden" name="intent" value="invitePortalUser" />
            <input type="hidden" name="shop"   value={shop || ''} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '8px', alignItems: 'end' }}>
              <div style={{ display: 'grid', gap: '4px' }}>
                <label style={{ fontSize: '11px', fontWeight: '700', color: C.textSub, textTransform: 'uppercase' }}>Name</label>
                <input name="name" type="text" placeholder="Jane Smith" required
                  style={{ ...input.base, fontSize: '13px' }} />
              </div>
              <div style={{ display: 'grid', gap: '4px' }}>
                <label style={{ fontSize: '11px', fontWeight: '700', color: C.textSub, textTransform: 'uppercase' }}>Email</label>
                <input name="email" type="email" placeholder="jane@brand.com" required
                  style={{ ...input.base, fontSize: '13px' }} />
              </div>
              <div style={{ display: 'grid', gap: '4px' }}>
                <label style={{ fontSize: '11px', fontWeight: '700', color: C.textSub, textTransform: 'uppercase' }}>Role</label>
                <select name="role" style={{ ...input.base, fontSize: '13px' }}>
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
            <button type="submit" style={{ ...btn.primary, justifySelf: 'start', fontSize: '13px' }}>
              Generate invite link
            </button>
          </Form>
        )}

        {/* Show generated invite link */}
        {actionData?.inviteUrl && (
          <div style={{ padding: '12px 14px', backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: '8px', marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', fontWeight: '700', color: '#065F46', marginBottom: '6px' }}>
              ✓ Invite created for {actionData.invitedEmail}
            </div>
            <div style={{ fontSize: '12px', color: '#065F46', marginBottom: '8px' }}>
              Share this link with them — it expires in 7 days:
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <code style={{ fontSize: '11px', backgroundColor: '#DCFCE7', padding: '6px 10px', borderRadius: '4px', flex: 1, wordBreak: 'break-all', color: '#065F46' }}>
                {actionData.inviteUrl}
              </code>
              <button type="button" onClick={copyInviteUrl}
                style={{ ...btn.primary, fontSize: '12px', padding: '6px 12px', whiteSpace: 'nowrap' }}>
                {copiedUrl ? '✓ Copied!' : 'Copy link'}
              </button>
            </div>
          </div>
        )}

        {actionData?.error && (
          <div style={{ padding: '10px 14px', backgroundColor: '#FEF2F2', color: '#DC2626', borderRadius: '6px', fontSize: '13px', fontWeight: '600', marginBottom: '16px' }}>
            {actionData.error}
          </div>
        )}

        {/* Portal users list */}
        {portalUsers.length === 0 ? (
          <p style={{ margin: 0, color: C.textSub, fontSize: '13px' }}>
            No portal users yet. Invite your team above.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: '8px' }}>
            {portalUsers.map(user => (
              <div key={user.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '10px', alignItems: 'center', padding: '10px 12px', border: `1px solid ${C.border}`, borderRadius: '6px' }}>
                <div>
                  <div style={{ fontWeight: '700', color: C.text, fontSize: '13px' }}>
                    {user.name}
                    <span style={{ marginLeft: '6px', fontSize: '10px', backgroundColor: C.surfaceHigh, color: C.textSub, borderRadius: '4px', padding: '1px 6px', fontWeight: '700', textTransform: 'uppercase' }}>
                      {user.role}
                    </span>
                    {!user.acceptedAt && (
                      <span style={{ marginLeft: '6px', fontSize: '10px', backgroundColor: '#FEF3C7', color: '#92400E', borderRadius: '4px', padding: '1px 6px', fontWeight: '700' }}>
                        Pending
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '12px', color: C.textSub, marginTop: '2px' }}>{user.email}</div>
                </div>
                {/* Resend invite if pending */}
                {!user.acceptedAt && (
                  <Form method="post">
                    <input type="hidden" name="intent" value="invitePortalUser" />
                    <input type="hidden" name="shop"  value={shop || ''} />
                    <input type="hidden" name="email" value={user.email} />
                    <input type="hidden" name="name"  value={user.name} />
                    <input type="hidden" name="role"  value={user.role} />
                    <button type="submit" style={{ ...btn.ghost, fontSize: '11px', padding: '4px 10px' }}>
                      Resend
                    </button>
                  </Form>
                )}
                <Form method="post" onSubmit={e => { if (!confirm(`Remove ${user.name}?`)) e.preventDefault(); }}>
                  <input type="hidden" name="intent"       value="revokePortalUser" />
                  <input type="hidden" name="portalUserId" value={user.id} />
                  <button type="submit" style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', fontSize: '18px', lineHeight: 1 }}>×</button>
                </Form>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Shopify Members ────────────────────────────────── */}
      <section style={card.base}>
        <h3 style={{ margin: '0 0 16px', ...section.title }}>Shopify Admin Members</h3>
        {members.length === 0 ? (
          <p style={{ margin: 0, color: C.textSub, fontSize: '13px' }}>
            No members yet. Members appear automatically when Shopify staff log into the app.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: '10px' }}>
            {members.map(member => (
              <Form key={member.id} method="post"
                style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '10px', alignItems: 'center', padding: '12px', border: `1px solid ${C.border}`, borderRadius: '6px' }}>
                <input type="hidden" name="intent"       value="updateRole" />
                <input type="hidden" name="membershipId" value={member.id} />
                <div>
                  <div style={{ fontWeight: 700, color: C.text, fontSize: '13px' }}>
                    {member.firstName || ''} {member.lastName || ''}
                    {member.isShopifyOwner && (
                      <span style={{ marginLeft: '6px', fontSize: '10px', backgroundColor: C.accentFaint, color: C.accent, borderRadius: '4px', padding: '1px 6px', fontWeight: '700' }}>
                        Owner
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '12px', color: C.textSub, marginTop: '2px' }}>
                    {member.email || 'No email'}
                  </div>
                </div>
                <select name="role" defaultValue={member.role}
                  style={{ ...input.base, minWidth: '110px', fontSize: '13px' }}>
                  {ROLES.map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                <button type="submit" style={{ ...btn.secondary, fontSize: '12px', padding: '6px 14px' }}>
                  Save
                </button>
              </Form>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  if (error instanceof Response) {
    return boundary.error(error);
  }
  return (
    <div style={{ padding: 20 }}>
      <h2>Something went wrong</h2>
      <pre style={{ fontSize: 12, color: '#dc2626' }}>
        {error?.message || String(error)}
      </pre>
    </div>
  );
}
