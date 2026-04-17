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

  const res  = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': session.accessToken },
    body:    JSON.stringify({ query: `{ locations(first: 50) { nodes { id name isActive } } }` }),
  });

  const body = await res.json();

  if (body.errors?.length) {
    return { count: 0, error: `Shopify API error: ${body.errors[0].message}` };
  }

  const locs = body?.data?.locations?.nodes ?? [];
  if (!locs.length) {
    return { count: 0, error: 'Shopify returned 0 locations. Your store may have no active locations.' };
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
    const resp  = await admin.graphql(`{ locations(first: 50) { nodes { id name isActive } } }`);
    const body  = await resp.json();
    const locs  = body?.data?.locations?.nodes ?? [];

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
