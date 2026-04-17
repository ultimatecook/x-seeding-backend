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
  const debug = [];
  try {
    const allSessions = await prisma.session.findMany({ where: { shop } });
    debug.push(`sessions in DB for shop "${shop}": ${allSessions.length}`);
    if (allSessions.length === 0) {
      debug.push('NO SESSION FOUND — open the app in Shopify admin first');
      return { locations: [], debug };
    }

    let session = allSessions.find(s => !s.isOnline && !s.expires)
      || allSessions.find(s => !s.isOnline)
      || allSessions[0];
    debug.push(`using session id=${session.id} isOnline=${session.isOnline} expires=${session.expires} hasToken=${!!session.accessToken}`);

    // Try GraphQL
    const gqlRes  = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': session.accessToken },
      body:    JSON.stringify({ query: `query { locations(first: 50) { nodes { id name isActive } } }` }),
    });
    const gqlBody = await gqlRes.json();
    debug.push(`GraphQL status=${gqlRes.status} errors=${JSON.stringify(gqlBody.errors)} nodeCount=${gqlBody?.data?.locations?.nodes?.length ?? 'null'}`);

    const gqlLocs = gqlBody?.data?.locations?.nodes;
    if (gqlLocs?.length > 0) return { locations: gqlLocs, debug };

    // Fallback: REST
    const restRes  = await fetch(`https://${shop}/admin/api/2025-10/locations.json?limit=50`, {
      headers: { 'X-Shopify-Access-Token': session.accessToken },
    });
    const restBody = await restRes.json();
    debug.push(`REST status=${restRes.status} count=${restBody?.locations?.length ?? 'null'} errors=${JSON.stringify(restBody?.errors)}`);

    const restLocs = (restBody?.locations ?? []).map(l => ({
      id:       `gid://shopify/Location/${l.id}`,
      name:     l.name,
      isActive: l.active,
    }));
    return { locations: restLocs, debug };
  } catch (e) {
    debug.push(`exception: ${e?.message}`);
    console.error('[inventory] fetchShopifyLocations error:', e?.message);
    return { locations: [], debug };
  }
}

/**
 * Sync Shopify locations into our DB for the given shop.
 * Creates rows for new locations, leaves existing ones alone.
 * Returns the DB rows.
 */
export async function syncLocations(shop) {
  const { locations: shopifyLocs, debug } = await fetchShopifyLocations(shop);
  console.log(`[inventory] syncLocations debug for ${shop}:`, debug.join(' | '));
  for (const loc of shopifyLocs) {
    await prisma.inventoryLocation.upsert({
      where:  { shop_shopifyLocationId: { shop, shopifyLocationId: loc.id } },
      update: { name: loc.name },
      create: { shop, shopifyLocationId: loc.id, name: loc.name, isEnabled: true, priorityOrder: 999 },
    });
  }
  return { count: shopifyLocs.length, debug };
}

/**
 * Sync locations using the authenticated `admin` object from authenticate.admin().
 * This always has a valid token — call this from Shopify admin routes.
 */
export async function syncLocationsWithAdmin(shop, admin) {
  try {
    const resp = await admin.graphql(`query { locations(first: 50) { nodes { id name isActive } } }`);
    const { data } = await resp.json();
    const locs = data?.locations?.nodes ?? [];
    for (const loc of locs) {
      await prisma.inventoryLocation.upsert({
        where:  { shop_shopifyLocationId: { shop, shopifyLocationId: loc.id } },
        update: { name: loc.name },
        create: { shop, shopifyLocationId: loc.id, name: loc.name, isEnabled: true, priorityOrder: 999 },
      });
    }
    console.log(`[inventory] syncLocationsWithAdmin: upserted ${locs.length} locations for ${shop}`);
  } catch (e) {
    console.error('[inventory] syncLocationsWithAdmin error:', e?.message);
  }
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
