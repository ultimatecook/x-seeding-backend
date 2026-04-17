/**
 * Inventory location utilities.
 *
 * Shopify locations are synced into the InventoryLocation table so admins
 * can enable/disable/reorder them without hitting the Shopify API every time.
 */
import prisma from '../db.server';

/**
 * Fetch active locations from Shopify using a stored offline access token.
 * Returns an array of { id, name, isActive }.
 */
export async function fetchShopifyLocations(shop) {
  try {
    let session = await prisma.session.findFirst({ where: { shop, isOnline: false, expires: null } });
    if (!session) session = await prisma.session.findFirst({ where: { shop, isOnline: false }, orderBy: { expires: 'desc' } });
    if (!session) session = await prisma.session.findFirst({ where: { shop }, orderBy: { expires: 'desc' } });
    if (!session?.accessToken) return [];

    const res  = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': session.accessToken },
      body:    JSON.stringify({
        query: `query { locations(first: 50, includeLegacy: false) { nodes { id name isActive } } }`,
      }),
    });
    const body = await res.json();
    return body?.data?.locations?.nodes ?? [];
  } catch (e) {
    console.error('[inventory] fetchShopifyLocations error:', e?.message);
    return [];
  }
}

/**
 * Sync Shopify locations into our DB for the given shop.
 * Creates rows for new locations, leaves existing ones alone.
 * Returns the DB rows.
 */
export async function syncLocations(shop) {
  const shopifyLocs = await fetchShopifyLocations(shop);
  for (const loc of shopifyLocs) {
    await prisma.inventoryLocation.upsert({
      where:  { shop_shopifyLocationId: { shop, shopifyLocationId: loc.id } },
      update: { name: loc.name },
      create: { shop, shopifyLocationId: loc.id, name: loc.name, isEnabled: true, priorityOrder: 999 },
    });
  }
  // Re-read sorted list
  return getInventoryLocations(shop, true);
}

/**
 * Get all (or only enabled) inventory locations for a shop, ordered by priority.
 */
export async function getInventoryLocations(shop, includeDisabled = false) {
  return prisma.inventoryLocation.findMany({
    where:   includeDisabled ? { shop } : { shop, isEnabled: true },
    orderBy: [{ priorityOrder: 'asc' }, { name: 'asc' }],
  });
}

/**
 * Get the top-priority enabled location GID for a shop.
 * Used when creating draft orders / fulfilment.
 */
export async function getPrimaryLocationId(shop) {
  const loc = await prisma.inventoryLocation.findFirst({
    where:   { shop, isEnabled: true },
    orderBy: [{ priorityOrder: 'asc' }, { name: 'asc' }],
  });
  return loc?.shopifyLocationId ?? null;
}
