import prisma from '../db.server';

async function getSession(shop) {
  const all = await prisma.session.findMany({ where: { shop } });
  return all.find(s => !s.isOnline && !s.expires)
    || all.find(s => !s.isOnline)
    || all[0]
    || null;
}

/**
 * Sync locations from Shopify using stored session token.
 * Returns { count, error } — error is a human-readable string if something went wrong.
 */
export async function syncLocations(shop) {
  const session = await getSession(shop);

  if (!session?.accessToken) {
    return { count: 0, error: 'No Shopify session found. Open the app in Shopify admin first.' };
  }

  // Try with name first (requires read_locations), fall back to address fields
  const queries = [
    `{ locations(first: 50) { nodes { id name isActive } } }`,
    `{ locations(first: 50) { nodes { id isActive address { address1 city } } } }`,
    `{ locations(first: 50) { nodes { id isActive } } }`,
  ];

  let locs = [];
  let lastError = null;

  for (const query of queries) {
    const res  = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': session.accessToken },
      body:    JSON.stringify({ query }),
    });
    const body = await res.json();
    const nodes = body?.data?.locations?.nodes ?? [];

    if (nodes.length > 0) {
      // Build a display name from whatever fields we got
      locs = nodes.map((loc, i) => ({
        id:       loc.id,
        isActive: loc.isActive,
        name:     loc.name
          || (loc.address ? [loc.address.address1, loc.address.city].filter(Boolean).join(', ')
          : `Location ${i + 1}`),
      }));
      break;
    }
    lastError = body.errors?.[0]?.message ?? null;
  }

  if (!locs.length) {
    return { count: 0, error: lastError ? `Shopify API error: ${lastError}` : 'No locations returned by Shopify.' };
  }

  for (const loc of locs) {
    await prisma.inventoryLocation.upsert({
      where:  { shop_shopifyLocationId: { shop, shopifyLocationId: loc.id } },
      update: { name: loc.name },
      create: { shop, shopifyLocationId: loc.id, name: loc.name, isEnabled: true, priorityOrder: 999 },
    });
  }

  return { count: locs.length, error: null };
}

/**
 * Sync using the authenticated admin object (from authenticate.admin).
 * Called from Shopify admin routes where auth is guaranteed.
 */
export async function syncLocationsWithAdmin(shop, admin) {
  try {
    // Try with name, fall back to address
    let resp = await admin.graphql(`{ locations(first: 50) { nodes { id name isActive } } }`);
    let body = await resp.json();
    let nodes = body?.data?.locations?.nodes ?? [];

    if (!nodes.length || body.errors?.length) {
      resp  = await admin.graphql(`{ locations(first: 50) { nodes { id isActive address { address1 city } } } }`);
      body  = await resp.json();
      nodes = body?.data?.locations?.nodes ?? [];
    }

    const locs = nodes.map((loc, i) => ({
      id:       loc.id,
      isActive: loc.isActive,
      name:     loc.name
        || (loc.address ? [loc.address.address1, loc.address.city].filter(Boolean).join(', ')
        : `Location ${i + 1}`),
    }));

    for (const loc of locs) {
      await prisma.inventoryLocation.upsert({
        where:  { shop_shopifyLocationId: { shop, shopifyLocationId: loc.id } },
        update: { name: loc.name },
        create: { shop, shopifyLocationId: loc.id, name: loc.name, isEnabled: true, priorityOrder: 999 },
      });
    }
    console.log(`[inventory] synced ${locs.length} locations for ${shop}`);
  } catch (e) {
    console.error('[inventory] syncLocationsWithAdmin error:', e?.message);
  }
}

export async function getInventoryLocations(shop, includeDisabled = false) {
  return prisma.inventoryLocation.findMany({
    where:   includeDisabled ? { shop } : { shop, isEnabled: true },
    orderBy: [{ priorityOrder: 'asc' }, { name: 'asc' }],
  });
}

export async function getPrimaryLocationId(shop) {
  const loc = await prisma.inventoryLocation.findFirst({
    where:   { shop, isEnabled: true },
    orderBy: [{ priorityOrder: 'asc' }, { name: 'asc' }],
  });
  return loc?.shopifyLocationId ?? null;
}
