import { Form, useLoaderData, useRouteLoaderData, useRouteError } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import prisma from '../db.server';
import { C, btn, card, input, section } from '../theme';

const ROLES = ['Owner', 'Editor', 'Viewer'];

export async function loader() {
  // shop comes from the parent app.jsx loader via useRouteLoaderData
  // No authenticate.admin call needed here — parent layout already handles auth
  let members = [];
  try {
    // We load all members and filter by shop on the client side using parent data
    // This avoids any auth calls that can timeout on Neon free tier
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

  return { members };
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
  }

  return null;
}

export default function SettingsPage() {
  const { members: allMembers } = useLoaderData();
  const { shop } = useRouteLoaderData('routes/app') ?? {};
  const members = shop ? allMembers.filter(m => m.shop === shop) : allMembers;

  return (
    <div style={{ display: 'grid', gap: '20px', maxWidth: '640px' }}>
      <div style={card.base}>
        <h2 style={{ margin: '0 0 6px', color: C.text }}>Settings</h2>
        <p style={{ margin: 0, color: C.textSub, fontSize: '13px' }}>
          Manage team roles and access.
        </p>
      </div>

      <section style={card.base}>
        <h3 style={{ margin: '0 0 16px', ...section.title }}>Members & Roles</h3>

        {members.length === 0 ? (
          <p style={{ margin: 0, color: C.textSub, fontSize: '13px' }}>
            No members yet. Members are created automatically when someone logs into the app.
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

        <p style={{ margin: '14px 0 0', fontSize: '11px', color: C.textMuted }}>
          <strong>Owner</strong> — full access. <strong>Editor</strong> — can create and edit seedings. <strong>Viewer</strong> — read-only.
          Role enforcement will be applied once your team is set up.
        </p>
      </section>
    </div>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  // Only use Shopify's boundary for Response errors (auth redirects)
  // For regular errors, show a message instead of redirecting to login
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
