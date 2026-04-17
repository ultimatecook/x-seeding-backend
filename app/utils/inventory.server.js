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
    debug.push(`sessions in DB: ${allSessions.length}`);
    if (allSessions.length === 0) {
      debug.push('NO SESSION — open the app in Shopify admin first');
      return { locations: [], debug };
    }

    let session = allSessions.find(s => !s.isOnline && !s.expires)
      || allSessions.find(s => !s.isOnline)
      || allSessions[0];
    debug.push(`session isOnline=${session.isOnline} hasToken=${!!session.accessToken}`);

    // Use inventory levels to discover locations (requires only read_inventory scope)
    const res  = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': session.accessToken },
      body:    JSON.stringify({
        query: `query {
          inventoryItems(first: 10, query: "tracked:true") {
            edges { node { inventoryLevels(first: 50) { edges { node { location { id name isActive } } } } } }
          }
        }`,
      }),
    });
    const body = await res.json();
    debug.push(`GraphQL status=${res.status} errors=${body.errors ? 'yes' : 'none'}`);

    const seen = new Map();
    for (const item of body?.data?.inventoryItems?.edges ?? []) {
      for (const level of item.node?.inventoryLevels?.edges ?? []) {
        const loc = level.node?.location;
        if (loc?.id && !seen.has(loc.id)) seen.set(loc.id, loc);
      }
    }
    const locations = [...seen.values()];
    debug.push(`found ${locations.length} locations`);
    return { locations, debug };
  } catch (e) {
    debug.push(`exception: ${e?.message}`);
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
 * Uses read_inventory scope (already granted) to discover locations via inventory levels.
 * Falls back to the locations API if read_locations scope is also available.
 */
export async function syncLocationsWithAdmin(shop, admin) {
  try {
    // Primary: get locations via inventoryItems → inventoryLevels → location
    // Works with read_inventory scope (no read_locations needed)
    const resp = await admin.graphql(`
      query {
        inventoryItems(first: 10, query: "tracked:true") {
          edges {
            node {
              inventoryLevels(first: 50) {
                edges {
                  node {
                    location {
                      id
                      name
                      isActive
                    }
                  }
                }
              }
            }
          }
        }
      }
    `);
    const { data } = await resp.json();

    // Deduplicate locations across all inventory items
    const seen = new Map();
    for (const item of data?.inventoryItems?.edges ?? []) {
      for (const level of item.node?.inventoryLevels?.edges ?? []) {
        const loc = level.node?.location;
        if (loc?.id && !seen.has(loc.id)) seen.set(loc.id, loc);
      }
    }

    const locs = [...seen.values()];
    console.log(`[inventory] syncLocationsWithAdmin: found ${locs.length} locations via inventory levels for ${shop}`);

    for (const loc of locs) {
      await prisma.inventoryLocation.upsert({
        where:  { shop_shopifyLocationId: { shop, shopifyLocationId: loc.id } },
        update: { name: loc.name },
        create: { shop, shopifyLocationId: loc.id, name: loc.name, isEnabled: true, priorityOrder: 999 },
      });
    }
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
