import { Form, useLoaderData, useRouteError } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import prisma from '../db.server';
import { C, btn, card, input, section } from '../theme';
import { requireRole } from '../utils/authz.server';
import { can } from '../utils/permissions';

const ROLES = ['Owner', 'Admin', 'Editor', 'Viewer'];

export async function loader({ request }) {
  const ctx = await requireRole(request, 'Viewer');
  const memberships = await prisma.appMembership.findMany({
    where: { shop: ctx.shop },
    include: {
      user: true,
    },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
  });

  return {
    currentUser: {
      id: ctx.user.id,
      email: ctx.user.email,
      role: ctx.role,
    },
    preferences: ctx.preferences,
    canManageMembers: can(ctx.role, 'manageMembers'),
    members: memberships.map((m) => ({
      id: m.id,
      role: m.role,
      userId: m.userId,
      email: m.user.email,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      isShopifyOwner: m.user.isShopifyOwner,
    })),
  };
}

export async function action({ request }) {
  const ctx = await requireRole(request, 'Viewer');
  const formData = await request.formData();
  const intent = formData.get('intent');

  if (intent === 'updatePreferences') {
    const highContrast = formData.get('highContrast') === 'on';
    const reducedMotion = formData.get('reducedMotion') === 'on';
    const rawFontScale = Number(formData.get('fontScale'));
    const fontScale = Number.isNaN(rawFontScale) ? 1 : Math.max(0.9, Math.min(1.25, rawFontScale));

    await prisma.userPreference.update({
      where: { userId: ctx.user.id },
      data: { highContrast, reducedMotion, fontScale },
    });

    return Response.json({ ok: true });
  }

  if (intent === 'updateRole') {
    if (!can(ctx.role, 'manageMembers')) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const membershipId = parseInt(formData.get('membershipId'));
    const role = String(formData.get('role') || '');

    if (!membershipId || !ROLES.includes(role)) {
      return new Response(JSON.stringify({ error: 'Invalid membership update' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await prisma.appMembership.update({
      where: { id: membershipId },
      data: { role },
    });

    return Response.json({ ok: true });
  }

  return new Response(JSON.stringify({ error: 'Unknown intent' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default function SettingsPage() {
  const { currentUser, preferences, canManageMembers, members } = useLoaderData();

  return (
    <div style={{ display: 'grid', gap: '20px' }}>
      <div style={card.base}>
        <h2 style={{ margin: '0 0 8px', color: C.text }}>Settings</h2>
        <p style={{ margin: 0, color: C.textSub, fontSize: '13px' }}>
          Signed in as {currentUser.email || 'Unknown user'} ({currentUser.role})
        </p>
      </div>

      <section style={card.base}>
        <h3 style={{ margin: '0 0 14px', ...section.title }}>My Accessibility</h3>
        <Form method="post" style={{ display: 'grid', gap: '12px', maxWidth: '420px' }}>
          <input type="hidden" name="intent" value="updatePreferences" />
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: C.text }}>
            <input type="checkbox" name="highContrast" defaultChecked={preferences.highContrast} />
            High contrast
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: C.text }}>
            <input type="checkbox" name="reducedMotion" defaultChecked={preferences.reducedMotion} />
            Reduced motion
          </label>
          <label style={{ color: C.text }}>
            Font scale
            <input
              name="fontScale"
              type="number"
              min="0.9"
              max="1.25"
              step="0.05"
              defaultValue={preferences.fontScale}
              style={{ ...input.base, marginTop: '6px' }}
            />
          </label>
          <button type="submit" style={{ ...btn.primary, width: 'fit-content' }}>
            Save preferences
          </button>
        </Form>
      </section>

      <section style={card.base}>
        <h3 style={{ margin: '0 0 14px', ...section.title }}>Members & Roles</h3>
        {!canManageMembers ? (
          <p style={{ margin: 0, color: C.textSub, fontSize: '13px' }}>
            Only Owner/Admin can edit member roles.
          </p>
        ) : null}
        <div style={{ display: 'grid', gap: '10px' }}>
          {members.map((member) => (
            <Form
              key={member.id}
              method="post"
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto auto',
                gap: '10px',
                alignItems: 'center',
                padding: '10px',
                border: `1px solid ${C.border}`,
                borderRadius: '6px',
              }}
            >
              <input type="hidden" name="intent" value="updateRole" />
              <input type="hidden" name="membershipId" value={member.id} />
              <div>
                <div style={{ fontWeight: 700, color: C.text }}>
                  {member.firstName || ''} {member.lastName || ''}
                </div>
                <div style={{ fontSize: '12px', color: C.textSub }}>
                  {member.email || 'No email'} {member.isShopifyOwner ? '(Shopify Owner)' : ''}
                </div>
              </div>
              <select
                name="role"
                defaultValue={member.role}
                style={{ ...input.base, minWidth: '120px' }}
                disabled={!canManageMembers}
              >
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
              <button type="submit" style={btn.secondary} disabled={!canManageMembers}>
                Update role
              </button>
            </Form>
          ))}
        </div>
      </section>
    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
