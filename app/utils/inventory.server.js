import prisma from '../db.server';

async function getSession(shop) {
  const all = await prisma.session.findMany({ where: { shop } });
  return all.find(s => !s.isOnline && !s.expires)
    || all.find(s => !s.isOnline)
    || all[0]
    || null;
}

function gidToNumeric(gid) {
  return gid?.split('/').pop() ?? gid;
}

async function fetchNodes(url, token, query) {
  const res  = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body:    JSON.stringify({ query }),
  });
  const body = await res.json();
  return { nodes: body?.data?.locations?.nodes ?? [], errors: body?.errors ?? [] };
}

export async function syncLocations(shop) {
  const session = await getSession(shop);
  if (!session?.accessToken) {
    return { count: 0, error: 'No Shopify session. Open the app in Shopify admin first.' };
  }

  const url = `https://${shop}/admin/api/2025-10/graphql.json`;

  // 1. Try with name (needs read_locations)
  let { nodes, errors } = await fetchNodes(url, session.accessToken, `{ locations(first: 50) { nodes { id name } } }`);

  // 2. If name is blocked, query id only — id is always accessible
  const nameBlocked = errors.some(e => e.path?.includes('name'));
  if (nameBlocked || !nodes.length) {
    ({ nodes, errors } = await fetchNodes(url, session.accessToken, `{ locations(first: 50) { nodes { id } } }`));
  }

  const validNodes = nodes.filter(n => n?.id);
  if (!validNodes.length) {
    return { count: 0, error: 'No locations found in your Shopify store.' };
  }

  for (const loc of validNodes) {
    // Use real name if available, otherwise use numeric ID from GID
    const name = loc.name || `Location ${gidToNumeric(loc.id)}`;
    await prisma.inventoryLocation.upsert({
      where:  { shop_shopifyLocationId: { shop, shopifyLocationId: loc.id } },
      update: {}, // don't overwrite a user-set name
      create: { shop, shopifyLocationId: loc.id, name, isEnabled: true, priorityOrder: 999 },
    });
  }

  return { count: validNodes.length, error: null };
}

export async function syncLocationsWithAdmin(shop, admin) {
  try {
    // Try name first, fall back to id-only
    let resp  = await admin.graphql(`{ locations(first: 50) { nodes { id name } } }`);
    let body  = await resp.json();
    let nodes = body?.data?.locations?.nodes ?? [];

    const nameBlocked = body.errors?.some(e => e.path?.includes('name'));
    if (nameBlocked || !nodes.length) {
      resp  = await admin.graphql(`{ locations(first: 50) { nodes { id } } }`);
      body  = await resp.json();
      nodes = body?.data?.locations?.nodes ?? [];
    }

    for (const loc of nodes.filter(n => n?.id)) {
      const name = loc.name || `Location ${gidToNumeric(loc.id)}`;
      await prisma.inventoryLocation.upsert({
        where:  { shop_shopifyLocationId: { shop, shopifyLocationId: loc.id } },
        update: {},
        create: { shop, shopifyLocationId: loc.id, name, isEnabled: true, priorityOrder: 999 },
      });
    }
    console.log(`[inventory] synced ${nodes.length} locations for ${shop}`);
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
