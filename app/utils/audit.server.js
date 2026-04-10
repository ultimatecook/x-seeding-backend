import prisma from '../db.server';

/**
 * Write an audit log entry. Never throws — audit failures shouldn't break actions.
 *
 * @param {object} params
 * @param {string} params.shop
 * @param {object} params.portalUser   - { id, name, email, role }
 * @param {string} params.action       - e.g. 'created_seeding'
 * @param {string} params.entityType   - 'seeding' | 'influencer' | 'campaign'
 * @param {number} [params.entityId]
 * @param {string} [params.detail]     - human-readable description
 */
export async function audit({ shop, portalUser, action, entityType, entityId, detail }) {
  try {
    await prisma.auditLog.create({
      data: {
        shop,
        portalUserId: portalUser.id,
        userName:     portalUser.name,
        userEmail:    portalUser.email,
        userRole:     portalUser.role,
        action,
        entityType,
        entityId:     entityId ?? null,
        detail:       detail   ?? null,
      },
    });
  } catch (e) {
    console.warn('Audit log write failed:', e.message);
  }
}
