/**
 * Discount code pool utilities.
 *
 * Codes are pre-loaded by admins in the /portal/admin page.
 * When a seeding is created, one Product code and one Shipping code
 * are atomically reserved from the pool.
 * When a seeding is deleted, the codes are released back to Available.
 */
import prisma from '../db.server';

/**
 * Assign one Product code to a seeding from the pool.
 * Shipping is handled via the draft order's shipping_line (price $0) so no
 * separate Shipping code is needed — this works on all Shopify plans.
 *
 * Returns { productCode: string|null }
 * (null means no code was available — seeding still succeeds).
 */
export async function assignDiscountCodes(shop, seedingId) {
  try {
    return await prisma.$transaction(async (tx) => {
      const productRow = await tx.discountCode.findFirst({
        where: { shop, poolType: 'Product', status: 'Available' },
        orderBy: { createdAt: 'asc' },
      });

      if (productRow) {
        await tx.discountCode.update({
          where: { id: productRow.id },
          data:  { status: 'Assigned', assignedSeedingId: seedingId },
        });
      }

      const productCode = productRow?.code ?? null;
      if (productCode) {
        await tx.seeding.update({
          where: { id: seedingId },
          data:  { productDiscountCode: productCode },
        });
      }

      return { productCode };
    });
  } catch (e) {
    console.error('[discount-codes] assignDiscountCodes error:', e?.message);
    return { productCode: null };
  }
}

/**
 * Release all discount codes assigned to a seeding back to the Available pool.
 * Call this before (or as part of) deleting a seeding.
 */
export async function releaseDiscountCodes(shop, seedingId) {
  try {
    await prisma.discountCode.updateMany({
      where: { shop, assignedSeedingId: seedingId },
      data:  { status: 'Available', assignedSeedingId: null },
    });
  } catch (e) {
    console.error('[discount-codes] releaseDiscountCodes error:', e?.message);
  }
}

/**
 * Mark codes as Used (call this when the seeding reaches "Delivered" or "Posted").
 * Optional — you can skip this and just leave them as Assigned.
 */
export async function markCodesUsed(shop, seedingId) {
  try {
    await prisma.discountCode.updateMany({
      where: { shop, assignedSeedingId: seedingId, status: 'Assigned' },
      data:  { status: 'Used' },
    });
  } catch (e) {
    console.error('[discount-codes] markCodesUsed error:', e?.message);
  }
}

/**
 * Return pool stats for the admin dashboard.
 */
export async function getPoolStats(shop) {
  try {
    const rows = await prisma.discountCode.groupBy({
      by:    ['poolType', 'status'],
      where: { shop },
      _count: { _all: true },
    });

    const stats = {
      Product:  { Available: 0, Assigned: 0, Used: 0 },
      Shipping: { Available: 0, Assigned: 0, Used: 0 },
    };
    for (const r of rows) {
      if (stats[r.poolType]) stats[r.poolType][r.status] = r._count._all;
    }
    return stats;
  } catch (e) {
    console.error('[discount-codes] getPoolStats error:', e?.message);
    return { Product: { Available: 0, Assigned: 0, Used: 0 }, Shipping: { Available: 0, Assigned: 0, Used: 0 } };
  }
}
