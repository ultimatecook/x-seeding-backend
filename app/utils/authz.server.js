import prisma from '../db.server';
import { authenticate } from '../shopify.server';
import { hasRole } from './permissions';

function sanitizeFontScale(value) {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return 1;
  return Math.min(1.25, Math.max(0.9, parsed));
}

function resolveDefaultRole(session) {
  if (session.accountOwner) return 'Owner';
  if (session.collaborator) return 'Editor';
  return 'Viewer';
}

export async function getAuthContext(request) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const shopifyUserId = session.userId ? String(session.userId) : null;
  const email = session.email ? String(session.email).toLowerCase() : null;

  let existingUser = null;
  if (shopifyUserId) {
    existingUser = await prisma.appUser.findUnique({
      where: { shop_shopifyUserId: { shop, shopifyUserId } },
    });
  } else if (email) {
    existingUser = await prisma.appUser.findUnique({
      where: { shop_email: { shop, email } },
    });
  }

  const user = existingUser
    ? await prisma.appUser.update({
        where: { id: existingUser.id },
        data: {
          firstName: session.firstName || null,
          lastName: session.lastName || null,
          email,
          isShopifyOwner: !!session.accountOwner,
          isShopifyStaff: !!session.collaborator,
          ...(shopifyUserId ? { shopifyUserId } : {}),
        },
      })
    : await prisma.appUser.create({
        data: {
          shop,
          shopifyUserId,
          email,
          firstName: session.firstName || null,
          lastName: session.lastName || null,
          isShopifyOwner: !!session.accountOwner,
          isShopifyStaff: !!session.collaborator,
        },
      });

  const membership = await prisma.appMembership.upsert({
    where: { shop_userId: { shop, userId: user.id } },
    update: {},
    create: {
      shop,
      userId: user.id,
      role: resolveDefaultRole(session),
    },
  });

  const preferences = await prisma.userPreference.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      highContrast: false,
      reducedMotion: false,
      fontScale: 1,
    },
  });

  return { admin, session, shop, user, membership, role: membership.role, preferences };
}

export async function requireRole(request, minimumRole = 'Viewer') {
  const ctx = await getAuthContext(request);
  if (!hasRole(ctx.role, minimumRole)) {
    throw new Response(
      JSON.stringify({
        error: `Forbidden: requires ${minimumRole} role`,
        role: ctx.role,
      }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }
  return ctx;
}

export async function updateAccessibilityPreferences(request) {
  const ctx = await requireRole(request, 'Viewer');
  const body = await request.json();

  const updated = await prisma.userPreference.update({
    where: { userId: ctx.user.id },
    data: {
      highContrast: !!body.highContrast,
      reducedMotion: !!body.reducedMotion,
      fontScale: sanitizeFontScale(body.fontScale),
    },
  });

  return { ...ctx, preferences: updated };
}
