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
    if (!session?.accessToken) {
      console.error('[inventory] no access token found for shop:', shop);
      return [];
    }

    // Try GraphQL first
    const gqlRes  = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': session.accessToken },
      body:    JSON.stringify({
        // omit includeLegacy to get all location types
        query: `query { locations(first: 50) { nodes { id name isActive } } }`,
      }),
    });
    const gqlBody = await gqlRes.json();
    const gqlLocs = gqlBody?.data?.locations?.nodes;
    if (gqlLocs?.length > 0) return gqlLocs;

    // Fallback: REST API (works even without read_locations scope on older tokens)
    console.warn('[inventory] GraphQL returned no locations, trying REST fallback');
    const restRes  = await fetch(`https://${shop}/admin/api/2025-10/locations.json?limit=50`, {
      headers: { 'X-Shopify-Access-Token': session.accessToken },
    });
    const restBody = await restRes.json();
    // Map REST shape { id, name, active } → same shape as GraphQL
    return (restBody?.locations ?? []).map(l => ({
      id:       `gid://shopify/Location/${l.id}`,
      name:     l.name,
      isActive: l.active,
    }));
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
  console.log(`[inventory] syncLocations: found ${shopifyLocs.length} locations from Shopify for ${shop}`);
  for (const loc of shopifyLocs) {
    await prisma.inventoryLocation.upsert({
      where:  { shop_shopifyLocationId: { shop, shopifyLocationId: loc.id } },
      update: { name: loc.name },
      create: { shop, shopifyLocationId: loc.id, name: loc.name, isEnabled: true, priorityOrder: 999 },
    });
  }
  return shopifyLocs.length;
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
