/**
 * Portal version of New Seeding.
 * Fetches Shopify products using the stored offline access token — no Shopify admin session needed.
 */
import { useState, useEffect, useRef } from 'react';
import { useLoaderData, useActionData, Form, useNavigate, redirect } from 'react-router';
import prisma from '../db.server';
import { requirePortalUser } from '../utils/portal-auth.server';
import { requirePermission } from '../utils/portal-permissions.js';
import { audit } from '../utils/audit.server.js';
import { fmtNum } from '../theme';
import { D, Pbtn as btn, Pinput as input } from '../utils/portal-theme';
import { useT } from '../utils/i18n';
import { guessProductCategory, extractSizeFromVariant } from '../utils/size-helpers';
import { assignDiscountCodes } from '../utils/discount-codes.server';
import { getPrimaryLocationId, getInventoryLocations } from '../utils/inventory.server';

// ── Loader ────────────────────────────────────────────────────────────────────
export async function loader({ request }) {
  const { shop, portalUser } = await requirePortalUser(request);
  requirePermission(portalUser.role, 'createSeeding');

  // Fetch Shopify products using stored offline access token.
  // Fetch ALL sessions for this shop ordered by preference, then try each until one works.
  let products = [];
  let productsError = null;
  let collections = [];
  try {
    // Collect all candidate sessions in priority order:
    // 1. Permanent offline (expires = null) first
    // 2. Non-expired offline tokens, newest first
    // 3. Any other session as last resort
    const allSessions = await prisma.session.findMany({
      where: { shop },
      orderBy: [{ expires: 'desc' }],
    });
    // Sort: null expires (permanent) first, then by isOnline=false preference
    allSessions.sort((a, b) => {
      if (a.expires === null && b.expires !== null) return -1;
      if (a.expires !== null && b.expires === null) return 1;
      if (!a.isOnline && b.isOnline) return -1;
      if (a.isOnline && !b.isOnline) return 1;
      return 0;
    });

    const candidates = allSessions.filter(s => s.accessToken);
    if (candidates.length === 0) {
      productsError = 'No Shopify session found. Please open the app in Shopify admin once to authorize it.';
    } else {
      const GQL_QUERY = `query GetProducts {
        products(first: 100, sortKey: TITLE, query: "status:active") {
          edges { node {
            id title
            featuredImage { url }
            variants(first: 30) { edges { node {
              id title price availableForSale
              inventoryItem { unitCost { amount } }
            } } }
          } }
        }
      }`;

      async function shopifyGQL(session, query) {
        const res  = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': session.accessToken },
          body:    JSON.stringify({ query }),
        });
        return { res, body: await res.json() };
      }

      let goodSession = null;
      for (const session of candidates) {
        const { res, body } = await shopifyGQL(session, GQL_QUERY);

        if (res.status === 401) {
          console.warn(`Portal: session ${session.id} returned 401, trying next...`);
          continue;
        }

        const hasErrors = body?.errors || body?.error;
        if (hasErrors) {
          let errMsg = 'unknown';
          if (typeof body.errors === 'string')  errMsg = body.errors;
          else if (Array.isArray(body.errors))  errMsg = body.errors[0]?.message ?? JSON.stringify(body.errors[0]);
          else if (body.error)                  errMsg = body.error_description ?? body.error;
          console.error('Portal: Shopify GraphQL error (HTTP', res.status, '):', errMsg);
          productsError = `Shopify API error (${res.status}): ${errMsg}`;
          break;
        }

        products = (body?.data?.products?.edges ?? []).map(edge => {
          const vars = edge.node.variants.edges;
          const hasStock = vars.some(v => v.node.availableForSale);
          return {
            id:       edge.node.id,
            name:     edge.node.title,
            image:    edge.node.featuredImage?.url ?? null,
            stock:    hasStock ? 1 : 0,
            variants: vars.map(v => ({
              id:        v.node.id,
              title:     v.node.title,
              price:     parseFloat(v.node.price || 0),
              cost:      parseFloat(v.node.inventoryItem?.unitCost?.amount || 0) || null,
              available: v.node.availableForSale,
            })),
            price:     parseFloat(vars[0]?.node?.price || 0),
            cost:      parseFloat(vars[0]?.node?.inventoryItem?.unitCost?.amount || 0) || null,
            variantId: vars[0]?.node?.id ?? null,
          };
        });
        if (products.length === 0) {
          console.warn('Portal: Shopify returned 0 products for shop', shop);
        }
        goodSession = session;
        break;
      }

      if (!goodSession && !productsError) {
        productsError = 'All stored Shopify tokens are invalid (401). Please open the app in Shopify admin to re-authorize.';
      }

      // Fetch collections using the same valid session
      if (goodSession) {
        try {
          const COLLECTIONS_QUERY = `query GetCollections {
            collections(first: 50, sortKey: TITLE) {
              edges { node {
                id title
                products(first: 250) {
                  edges { node { id } }
                }
              } }
            }
          }`;
          const { body: cb } = await shopifyGQL(goodSession, COLLECTIONS_QUERY);
          collections = (cb?.data?.collections?.edges ?? []).map(e => ({
            id:         e.node.id,
            title:      e.node.title,
            productIds: new Set(e.node.products.edges.map(p => p.node.id)),
          }));
        } catch (ce) {
          console.warn('Portal: could not fetch collections:', ce.message);
        }
      }
    }
  } catch (e) {
    console.error('Portal: failed to fetch Shopify products:', e.message);
    productsError = `Failed to load products: ${e.message}`;
  }

  const influencers = await prisma.influencer.findMany({
    where: { shop, archived: false }, orderBy: { name: 'asc' },
  });
  const campaigns = await prisma.campaign.findMany({
    where: { shop, archived: false }, orderBy: { createdAt: 'desc' }, include: { products: true },
  });

  const since = new Date();
  since.setDate(since.getDate() - 90);
  const recentSeedings = await prisma.seeding.findMany({
    where:  { shop, createdAt: { gte: since } },
    select: { influencerId: true, products: { select: { productId: true } }, createdAt: true },
  });
  const recentlySeededMap = {};
  for (const s of recentSeedings) {
    if (!recentlySeededMap[s.influencerId]) recentlySeededMap[s.influencerId] = {};
    for (const p of s.products) {
      const existing = recentlySeededMap[s.influencerId][p.productId];
      if (!existing || new Date(s.createdAt) > new Date(existing)) {
        recentlySeededMap[s.influencerId][p.productId] = s.createdAt;
      }
    }
  }

  let allSavedSizes = {};
  try {
    const savedSizes = await prisma.influencerSavedSize.findMany({
      where: { influencer: { shop } },
    });
    for (const ss of savedSizes) {
      if (!allSavedSizes[ss.influencerId]) allSavedSizes[ss.influencerId] = {};
      allSavedSizes[ss.influencerId][ss.category] = ss.size;
    }
  } catch (e) {
    console.warn('influencerSavedSize table not ready:', e.message);
  }

  // Serialize collections (Set isn't JSON-serializable)
  const collectionsData = collections.map(c => ({
    id:         c.id,
    title:      c.title,
    productIds: [...c.productIds],
  }));

  const enabledLocations = await getInventoryLocations(shop); // enabled only, includes all types

  const availableProductCodes = await prisma.discountCode.count({
    where: { shop, poolType: 'Product', status: 'Available' },
  });

  // ── Guest pre-fill (when coming from "Create seeding" on a campaign guest) ──
  const url          = new URL(request.url);
  const guestIdParam = url.searchParams.get('guestId');
  let prefillGuest   = null;
  if (guestIdParam) {
    try {
      const guest = await prisma.campaignGuest.findUnique({
        where:   { id: parseInt(guestIdParam) },
        include: { items: true, influencer: true, campaign: { select: { id: true, shop: true } } },
      });
      if (guest && guest.campaign.shop === shop) {
        prefillGuest = {
          id:           guest.id,
          campaignId:   guest.campaignId,
          influencerId: guest.influencerId,
          influencer:   guest.influencer,
          items:        guest.items,
        };
      }
    } catch (e) {
      console.warn('Portal: could not load prefill guest:', e.message);
    }
  }

  return { products, productsError, collections: collectionsData, influencers, campaigns, recentlySeededMap, allSavedSizes, shop, enabledLocations, availableProductCodes, prefillGuest };
}

// ── Action ────────────────────────────────────────────────────────────────────
export async function action({ request }) {
  const { shop, portalUser } = await requirePortalUser(request);
  requirePermission(portalUser.role, 'createSeeding');

  const formData       = await request.formData();
  const influencerId   = parseInt(formData.get('influencerId'));
  const campaignIdRaw  = formData.get('campaignId');
  const campaignId     = campaignIdRaw ? parseInt(campaignIdRaw) : null;
  const productIds     = formData.getAll('productIds');
  const variantIds     = formData.getAll('variantIds');
  const productNames   = formData.getAll('productNames');
  const productPrices  = formData.getAll('productPrices').map(Number);
  const productCosts   = formData.getAll('productCosts').map(v => v ? Number(v) : null);
  const productImages  = formData.getAll('productImages');
  const productSizes   = formData.getAll('productSizes');
  const productCategories = formData.getAll('productCategories');
  const totalCost      = productPrices.reduce((sum, p) => sum + p, 0);
  const notes          = formData.get('notes') || '';

  const seedingType       = formData.get('seedingType') || 'Online'; // 'Online' | 'InStore'
  const storeLocationId   = formData.get('storeLocationId')   || null;
  const storeLocationName = formData.get('storeLocationName') || null;

  const productsWithoutSize = productSizes.filter(s => !s || s.trim() === '');
  if (productsWithoutSize.length > 0) {
    return { error: 'All products must have a size selected.' };
  }

  const influencer = await prisma.influencer.findUnique({ where: { id: influencerId } });
  if (!influencer || influencer.shop !== shop) return { error: 'Influencer not found.' };

  // ── Discount code check ──────────────────────────────────────────────────
  const availableCodes = await prisma.discountCode.count({ where: { shop, poolType: 'Product', status: 'Available' } });
  if (availableCodes === 0) {
    return { error: 'No discount codes available in the pool. Please add codes before creating a seeding.' };
  }

  // ── Campaign validation ──────────────────────────────────────────────────
  if (campaignId) {
    const camp = await prisma.campaign.findUnique({
      where:   { id: campaignId },
      include: {
        products: true,
        seedings: { include: { products: { select: { productId: true } } } },
      },
    });

    if (camp && camp.shop === shop) {
      // Step 1: Hard allocation check — block if any product exceeds its limit
      const usedUnits = {};
      for (const s of camp.seedings) {
        for (const p of s.products) {
          usedUnits[p.productId] = (usedUnits[p.productId] || 0) + 1;
        }
      }
      for (const cp of camp.products) {
        if (cp.allocatedUnits == null) continue;
        const currentlyUsed  = usedUnits[cp.productId] || 0;
        const newUnitsForThis = productIds.filter(pid => pid === cp.productId).length;
        if (newUnitsForThis > 0 && currentlyUsed + newUnitsForThis > cp.allocatedUnits) {
          return {
            error: `Allocation exceeded for "${cp.productName}": ${currentlyUsed} of ${cp.allocatedUnits} units already used. ${Math.max(0, cp.allocatedUnits - currentlyUsed)} remaining.`,
          };
        }
      }

      // Step 2: Soft budget check — warn but don't block (bypass with bypassBudget=1)
      const bypassBudget = formData.get('bypassBudget') === '1';
      if (!bypassBudget && camp.budget != null) {
        const budgetUsed = camp.seedings.reduce((sum, s) => sum + (s.totalCost || 0), 0);
        if (budgetUsed + totalCost > camp.budget) {
          return {
            budgetWarning:  true,
            budgetMessage:  `This seeding (€${totalCost.toFixed(2)}) will exceed the campaign budget of €${camp.budget.toFixed(2)}. Currently used: €${budgetUsed.toFixed(2)} of €${camp.budget.toFixed(2)}.`,
          };
        }
      }
    }
  }

  let shopifyDraftOrderId = null;
  let shopifyOrderName    = null;
  let invoiceUrl          = null;

  // Only create a Shopify draft order for online seedings
  if (seedingType === 'Online') {
    try {
      let session = await prisma.session.findFirst({ where: { shop, isOnline: false, expires: null } });
      if (!session) session = await prisma.session.findFirst({ where: { shop, isOnline: false }, orderBy: { expires: 'desc' } });
      if (!session) session = await prisma.session.findFirst({ where: { shop }, orderBy: { expires: 'desc' } });
      if (session?.accessToken) {
        const locationId = await getPrimaryLocationId(shop);
        const lineItems  = variantIds.filter(v => v && v.length > 0).map(variantId => ({ variantId, quantity: 1 }));
        if (lineItems.length === 0) {
          console.warn('Portal: no valid variantIds — skipping draft order. variantIds received:', variantIds);
        } else {
        const mutation   = `mutation DraftOrderCreate($input: DraftOrderInput!) {
          draftOrderCreate(input: $input) {
            draftOrder { id name invoiceUrl }
            userErrors { field message }
          }
        }`;
        const draftInput = {
          lineItems,
          appliedDiscount: { value: 100, valueType: 'PERCENTAGE', title: 'Seeding Gift – 100% Off' },
          note: `Seeding for ${influencer?.handle ?? ''} (${influencer?.name ?? ''})`,
          tags: ['seeding'],
        };
        if (influencer?.email) draftInput.email = influencer.email;

        const res  = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': session.accessToken },
          body: JSON.stringify({ query: mutation, variables: { input: draftInput } }),
        });
        const body  = await res.json();
        const errors = body?.data?.draftOrderCreate?.userErrors;
        if (errors?.length) {
          console.error('Portal: Shopify draftOrderCreate userErrors:', JSON.stringify(errors));
        }
        const draft = body?.data?.draftOrderCreate?.draftOrder;
        if (draft) {
          shopifyDraftOrderId = draft.id;
          shopifyOrderName    = draft.name;
          invoiceUrl          = draft.invoiceUrl;

          // invoiceUrl is often null from GraphQL — fetch via REST which always returns it
          if (!invoiceUrl && draft.id) {
            try {
              const numericId = draft.id.split('/').pop();
              const restRes = await fetch(`https://${shop}/admin/api/2025-10/draft_orders/${numericId}.json`, {
                headers: { 'X-Shopify-Access-Token': session.accessToken },
              });
              const restBody = await restRes.json();
              invoiceUrl = restBody?.draft_order?.invoice_url ?? null;
              console.log('Portal: fetched invoiceUrl via REST:', invoiceUrl);
            } catch (e) {
              console.warn('Portal: could not fetch invoiceUrl via REST:', e.message);
            }
          }
        } else {
          console.warn('Portal: draft order not returned. Full body:', JSON.stringify(body));
        }
        } // end lineItems.length check
      }
    } catch (err) {
      console.error('Portal: failed to create Shopify draft order:', err.message);
    }
  }

  const seeding = await prisma.seeding.create({
    data: {
      shop, influencerId, campaignId, totalCost, notes, status: 'Pending',
      seedingType, storeLocationId, storeLocationName,
      shopifyDraftOrderId, shopifyOrderName, invoiceUrl,
      products: {
        create: productIds.map((productId, i) => ({
          productId,
          variantId:   variantIds[i]   || null,
          productName: productNames[i] || '',
          price:       productPrices[i] || 0,
          cost:        productCosts[i]  || null,
          imageUrl:    productImages[i] || null,
          size:        productSizes[i]  || null,
          category:    productCategories[i] || null,
        })),
      },
    },
  });

  // ── Link guest to seeding if this came from a guest conversion ──────────────
  const guestIdRaw = formData.get('guestId');
  const guestId    = guestIdRaw ? parseInt(guestIdRaw) : null;
  if (guestId) {
    try {
      await prisma.campaignGuest.update({ where: { id: guestId }, data: { seedingId: seeding.id } });
      await prisma.guestItem.updateMany({ where: { guestId }, data: { fulfilled: true } });
    } catch (e) {
      console.warn('Portal: could not link guest to seeding:', e.message);
    }
  }

  // Assign discount codes from pool (best-effort — won't fail seeding creation)
  let assignedCodes = null;
  try {
    assignedCodes = await assignDiscountCodes(shop, seeding.id);
    // Re-fetch to get the assigned codes
    const updated = await prisma.seeding.findUnique({ where: { id: seeding.id }, select: { productDiscountCode: true, shippingDiscountCode: true } });
    if (updated) assignedCodes = updated;
  } catch (e) {
    console.warn('Portal: could not assign discount codes:', e.message);
  }

  await audit({
    shop, portalUser,
    action: 'created_seeding',
    entityType: 'seeding',
    entityId: seeding.id,
    detail: `Created ${seedingType === 'InStore' ? 'in-store' : 'online'} seeding for ${influencer?.handle ?? influencerId} (${productIds.length} product${productIds.length !== 1 ? 's' : ''}, €${totalCost.toFixed(2)})${storeLocationName ? ` at ${storeLocationName}` : ''}`,
  });

  // Save sizes for next time
  try {
    for (let i = 0; i < productIds.length; i++) {
      const category = productCategories[i];
      const size     = productSizes[i];
      if (category && size) {
        await prisma.influencerSavedSize.upsert({
          where:  { influencerId_category: { influencerId, category } },
          update: { size },
          create: { influencerId, category, size },
        });
      }
    }
  } catch (e) {
    console.warn('Portal: could not save sizes:', e.message);
  }

  // For in-store seedings: return the code to display — don't redirect
  if (seedingType === 'InStore') {
    const fresh = await prisma.seeding.findUnique({ where: { id: seeding.id }, select: { productDiscountCode: true, shippingDiscountCode: true } });
    return {
      inStoreSuccess:      true,
      seedingId:           seeding.id,
      storeName:           storeLocationName,
      influencerHandle:    influencer.handle,
      productCode:         fresh?.productDiscountCode ?? null,
      shippingCode:        fresh?.shippingDiscountCode ?? null,
    };
  }

  // If converted from a campaign guest, redirect back to the campaign
  if (guestId && campaignId) {
    return redirect(`/portal/campaigns/${campaignId}`);
  }
  return redirect('/portal/seedings');
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const COUNTRY_CODES = {
  'Afghanistan':'AF','Albania':'AL','Algeria':'DZ','Argentina':'AR','Australia':'AU',
  'Austria':'AT','Belgium':'BE','Brazil':'BR','Canada':'CA','Chile':'CL','China':'CN',
  'Colombia':'CO','Croatia':'HR','Czech Republic':'CZ','Denmark':'DK','Ecuador':'EC',
  'Egypt':'EG','Finland':'FI','France':'FR','Germany':'DE','Greece':'GR','Hungary':'HU',
  'India':'IN','Indonesia':'ID','Iran':'IR','Ireland':'IE','Israel':'IL','Italy':'IT',
  'Japan':'JP','Jordan':'JO','Kenya':'KE','Malaysia':'MY','Mexico':'MX',
  'Netherlands':'NL','New Zealand':'NZ','Nigeria':'NG','Norway':'NO','Pakistan':'PK',
  'Peru':'PE','Philippines':'PH','Poland':'PL','Portugal':'PT','Romania':'RO',
  'Russia':'RU','Saudi Arabia':'SA','Serbia':'RS','Singapore':'SG','South Africa':'ZA',
  'South Korea':'KR','Spain':'ES','Sweden':'SE','Switzerland':'CH','Taiwan':'TW',
  'Thailand':'TH','Turkey':'TR','Ukraine':'UA','United Arab Emirates':'AE',
  'United Kingdom':'GB','United States':'US','Vietnam':'VN',
};

// Real flag images via flagcdn.com — no broken emoji on all platforms
function FlagImg({ code, size = 16 }) {
  if (!code) return null;
  const lc  = code.toLowerCase();
  const h   = Math.round(size * 0.75);
  return (
    <img
      src={`https://flagcdn.com/${size}x${h}/${lc}.png`}
      srcSet={`https://flagcdn.com/${size * 2}x${h * 2}/${lc}.png 2x`}
      width={size} height={h}
      alt={code}
      style={{ display: 'inline-block', verticalAlign: 'middle', borderRadius: '2px', objectFit: 'cover', flexShrink: 0 }}
      onError={e => { e.currentTarget.style.display = 'none'; }}
    />
  );
}

function fmtFollowers(n) {
  if (!n) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

const FOLLOWER_RANGES = [
  { label: 'All',    min: 0,         max: Infinity },
  { label: '<10K',   min: 0,         max: 10_000 },
  { label: '10–50K', min: 10_000,    max: 50_000 },
  { label: '50–100K',min: 50_000,    max: 100_000 },
  { label: '100K+',  min: 100_000,   max: Infinity },
];

function Chip({ label, active, onClick }) {
  return (
    <button type="button" onClick={onClick} style={{
      padding: '3px 9px', fontSize: '11px', fontWeight: active ? '700' : '500',
      borderRadius: '5px', border: 'none',
      backgroundColor: active ? D.accentFaint : 'transparent',
      color: active ? D.accent : D.textMuted,
      cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.1s',
    }}>{label}</button>
  );
}

// Backwards compat — some callers still use Pill
function Pill({ label, active, onClick }) {
  return <Chip label={label} active={active} onClick={onClick} />;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function PortalNewSeeding() {
  const { products, productsError, collections, influencers, campaigns, recentlySeededMap, allSavedSizes, shop, enabledLocations, availableProductCodes, prefillGuest } = useLoaderData();
  const actionData = useActionData();
  const navigate   = useNavigate();
  const { t }      = useT();

  const onlineLocations = (enabledLocations ?? []).filter(l => l.locationType === 'Online');
  const storeLocations  = (enabledLocations ?? []).filter(l => l.locationType === 'Store');

  const [seedingType,        setSeedingType]        = useState('Online'); // 'Online' | 'InStore'
  const [selectedStore,      setSelectedStore]      = useState(null);    // { id, shopifyLocationId, name }
  const [selectedInfluencer, setSelectedInfluencer] = useState(null);
  const [selectedCampaign,   setSelectedCampaign]   = useState(null);
  const [selectedProducts,   setSelectedProducts]   = useState([]);
  const [notes,              setNotes]              = useState('');
  const [infSearch,          setInfSearch]          = useState('');
  const [infFollowerRange,   setInfFollowerRange]   = useState('All');
  const [infCountry,         setInfCountry]         = useState('');
  const [search,             setSearch]             = useState('');
  const [selectedCollection, setSelectedCollection] = useState(null);
  const [dragOver,           setDragOver]           = useState(false);
  const [shakeId,            setShakeId]            = useState(null);
  const [dragProductId,      setDragProductId]      = useState(null);
  const [submitError,        setSubmitError]        = useState(null);
  const [submitting,         setSubmitting]         = useState(false);

  const formRef          = useRef(null);
  const bypassBudgetRef  = useRef(null);
  const prefillApplied   = useRef(false);

  const recentlySeedMapForInfluencer = selectedInfluencer
    ? (recentlySeededMap[selectedInfluencer.id] ?? {})
    : {};

  const influencerSizeMap = selectedInfluencer?.id
    ? (allSavedSizes[selectedInfluencer.id] ?? {})
    : {};

  useEffect(() => {
    if (!selectedInfluencer?.id) return;
    const sizeMap = allSavedSizes[selectedInfluencer.id] ?? {};
    if (Object.keys(sizeMap).length === 0) return;
    setSelectedProducts(prev =>
      prev.map(p => {
        if (p.size) return p;
        const savedSize = sizeMap[p.category];
        return savedSize ? { ...p, size: savedSize } : p;
      })
    );
  }, [selectedInfluencer?.id]);

  // ── Pre-fill from guest when arriving via "Create seeding" button ────────────
  useEffect(() => {
    if (!prefillGuest || prefillApplied.current) return;
    prefillApplied.current = true;

    // Set campaign
    if (prefillGuest.campaignId) {
      const camp = campaigns.find(c => c.id === prefillGuest.campaignId);
      if (camp) setSelectedCampaign(camp);
    }

    // Set influencer
    if (prefillGuest.influencerId) {
      const inf = influencers.find(i => i.id === prefillGuest.influencerId);
      if (inf) setSelectedInfluencer(inf);
    }

    // Set products from guest items — match against Shopify catalogue first
    if (prefillGuest.items?.length > 0) {
      const sizeMapForGuest = prefillGuest.influencerId
        ? (allSavedSizes[prefillGuest.influencerId] ?? {})
        : {};
      const prods = prefillGuest.items.map(item => {
        const shopifyProd = products.find(p => p.id === item.productId);
        if (shopifyProd) {
          const category  = guessProductCategory(shopifyProd.name);
          const savedSize = sizeMapForGuest[category];
          const isOneSize = !shopifyProd.variants || shopifyProd.variants.length <= 1;
          let matchedVariant = null;
          let size           = null;
          let sizeUnavailable = false;
          if (isOneSize) {
            matchedVariant = shopifyProd.variants?.[0] ?? null;
            size           = 'One Size';
          } else if (savedSize) {
            const match = shopifyProd.variants.find(v => extractSizeFromVariant(v.title) === savedSize);
            if (match) {
              matchedVariant  = match;
              size            = extractSizeFromVariant(match.title);
              sizeUnavailable = match.available === false;
            } else {
              sizeUnavailable = true;
            }
          }
          return { ...shopifyProd, selectedVariant: matchedVariant, category, size, sizeUnavailable };
        }
        // Fallback: build a minimal product object from guest item data
        return {
          id:              item.productId,
          name:            item.productName,
          image:           item.imageUrl ?? null,
          price:           item.price ?? 0,
          variants:        [],
          selectedVariant: null,
          category:        null,
          size:            'One Size',
          sizeUnavailable: false,
        };
      });
      setSelectedProducts(prods.filter(Boolean));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Top 5 countries by influencer count
  const countryCounts = {};
  for (const inf of influencers) {
    if (inf.country) countryCounts[inf.country] = (countryCounts[inf.country] ?? 0) + 1;
  }
  const topCountries = Object.entries(countryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([c]) => c);
  const selectedRange = FOLLOWER_RANGES.find(r => r.label === infFollowerRange) ?? FOLLOWER_RANGES[0];

  const filteredInfluencers = influencers.filter(inf => {
    if (infSearch) {
      const q = infSearch.toLowerCase();
      if (!inf.handle.toLowerCase().includes(q) && !(inf.name ?? '').toLowerCase().includes(q)) return false;
    }
    if (infCountry && inf.country !== infCountry) return false;
    if (infFollowerRange !== 'All') {
      const f = inf.followers ?? 0;
      if (f < selectedRange.min || f >= selectedRange.max) return false;
    }
    return true;
  });

  const campaignProductIds = selectedCampaign
    ? new Set(selectedCampaign.products.map(cp => cp.productId))
    : null;

  const collectionProductIds = selectedCollection
    ? new Set(selectedCollection.productIds)
    : null;

  const filteredProducts = products.filter(p => {
    if (campaignProductIds && !campaignProductIds.has(p.id))    return false;
    if (collectionProductIds && !collectionProductIds.has(p.id)) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  function handleDrop(prod) {
    if (selectedProducts.find(p => p.id === prod.id)) return;
    if (recentlySeedMapForInfluencer[prod.id]) {
      setShakeId(prod.id);
      setTimeout(() => setShakeId(null), 500);
      return;
    }
    const category   = guessProductCategory(prod.name);
    const savedSize  = influencerSizeMap[category];
    const isOneSize  = !prod.variants || prod.variants.length <= 1;

    let matchedVariant  = null;
    let size            = null;
    let sizeUnavailable = false;

    if (isOneSize) {
      matchedVariant = prod.variants?.[0] ?? null;
      size           = 'One Size';
    } else if (savedSize) {
      const match = prod.variants.find(v => extractSizeFromVariant(v.title) === savedSize);
      if (match) {
        matchedVariant  = match;
        size            = extractSizeFromVariant(match.title);
        sizeUnavailable = match.available === false;
      } else {
        sizeUnavailable = true;
      }
    }

    setSelectedProducts(prev => [...prev, {
      ...prod,
      selectedVariant: matchedVariant,
      category,
      size,
      sizeUnavailable,
    }]);
  }

  const totalRetail  = selectedProducts.reduce((sum, p) => sum + (p.selectedVariant?.price ?? p.price ?? 0), 0);
  const allHaveSizes = selectedProducts.every(p => p.size);
  const hasEnabledLocation = seedingType === 'Online'
    ? onlineLocations.length > 0
    : storeLocations.length > 0;
  const hasSelectedStore = seedingType === 'InStore' ? selectedStore !== null : true;
  const hasProductCodes = availableProductCodes > 0;
  const canSubmit = !submitting && selectedInfluencer && selectedProducts.length > 0 && allHaveSizes && hasEnabledLocation && hasSelectedStore && hasProductCodes;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!selectedInfluencer)          { setSubmitError('Select an influencer first.'); return; }
    if (selectedProducts.length === 0){ setSubmitError('Add at least one product.'); return; }
    if (!allHaveSizes)                { setSubmitError('All products must have a size selected.'); return; }
    setSubmitting(true);
    setSubmitError(null);
    e.target.submit();
  }

  // ── In-store success overlay ─────────────────────────────────────────────────
  if (actionData?.inStoreSuccess) {
    const { storeName, influencerHandle, productCode, shippingCode } = actionData;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: '24px', padding: '40px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: '48px' }}>🏪</div>
        <div>
          <h2 style={{ margin: '0 0 6px', fontSize: '22px', fontWeight: '800', color: D.text }}>{t('newSeeding.success.title')}</h2>
          <p style={{ margin: 0, fontSize: '14px', color: D.textSub }}>
            @{influencerHandle} · {storeName}
          </p>
        </div>

        <div style={{ width: '100%', maxWidth: '420px', backgroundColor: D.surface, border: `1px solid ${D.border}`, borderRadius: '16px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <p style={{ margin: 0, fontSize: '13px', color: D.textSub }}>
            {t('newSeeding.success.instrAt', { storeName })}
          </p>

          {productCode ? (
            <div style={{ backgroundColor: '#F3F0FF', border: '1.5px solid #C4B5FD', borderRadius: '12px', padding: '20px' }}>
              <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.6px', color: '#6D28D9', marginBottom: '8px' }}>
                {t('newSeeding.success.code')}
              </div>
              <div style={{
                fontFamily: 'monospace', fontSize: '28px', fontWeight: '800',
                color: '#4C1D95', letterSpacing: '3px', userSelect: 'all',
              }}>
                {productCode}
              </div>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(productCode)}
                style={{ marginTop: '10px', padding: '5px 14px', fontSize: '11px', fontWeight: '700', borderRadius: '6px', border: '1px solid #C4B5FD', backgroundColor: '#EDE9FE', color: '#5B21B6', cursor: 'pointer' }}>
                {t('newSeeding.success.copyCode')}
              </button>
            </div>
          ) : (
            <div style={{ padding: '16px', backgroundColor: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: '10px', fontSize: '13px', color: '#92400E' }}>
              {t('newSeeding.success.noCode')}
            </div>
          )}

          {shippingCode && (
            <div style={{ fontSize: '12px', color: D.textSub }}>
              {t('newSeeding.success.shippingCode')} <code style={{ fontWeight: '700', color: D.text }}>{shippingCode}</code>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button type="button" onClick={() => navigate('/portal/seedings')}
            style={{ padding: '10px 24px', borderRadius: '9px', border: `1px solid ${D.border}`, backgroundColor: D.surface, color: D.textSub, fontWeight: '700', fontSize: '13px', cursor: 'pointer' }}>
            {t('newSeeding.success.viewAll')}
          </button>
          <button type="button" onClick={() => window.location.reload()}
            style={{ padding: '10px 24px', borderRadius: '9px', border: 'none', background: `linear-gradient(135deg, ${D.accent} 0%, ${D.purple} 100%)`, color: '#fff', fontWeight: '700', fontSize: '13px', cursor: 'pointer' }}>
            {t('newSeeding.success.newSeeding')}
          </button>
        </div>
      </div>
    );
  }

  // ── CTA label logic ────────────────────────────────────────────────────────
  let ctaLabel;
  if (submitting) {
    ctaLabel = t('newSeeding.submitting');
  } else if (!hasEnabledLocation) {
    ctaLabel = seedingType === 'InStore' ? 'Configure a store location' : 'Configure online location';
  } else if (!hasProductCodes) {
    ctaLabel = 'No discount codes available';
  } else if (seedingType === 'InStore' && !selectedStore) {
    ctaLabel = 'Select a store';
  } else if (!selectedInfluencer) {
    ctaLabel = 'Select an influencer';
  } else if (selectedProducts.length === 0) {
    ctaLabel = 'Select products';
  } else if (!allHaveSizes) {
    ctaLabel = 'Select sizes for all products';
  } else {
    ctaLabel = `Send ${selectedProducts.length} product${selectedProducts.length !== 1 ? 's' : ''} →`;
  }

  return (
    <div>
      <style>{`
        @keyframes shake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-4px)} 40%{transform:translateX(4px)} 60%{transform:translateX(-3px)} 80%{transform:translateX(3px)} }
        @keyframes slideUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        .inf-row:hover { background: ${D.surfaceHigh} !important; }
        .inf-row-selected { background: ${D.accentFaint} !important; }
        .prod-card { transition: box-shadow 0.12s ease, transform 0.12s ease; cursor: pointer; }
        .prod-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.08); transform: translateY(-1px); }
        .new-seeding-left::-webkit-scrollbar { width: 4px; }
        .new-seeding-left::-webkit-scrollbar-thumb { background: ${D.border}; border-radius: 4px; }
      `}</style>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '28px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: '800', color: D.text, letterSpacing: '-0.4px' }}>{t('newSeeding.title')}</h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: D.textMuted }}>{t('newSeeding.subtitle')}</p>
        </div>
        <button type="button" onClick={() => navigate('/portal/seedings')}
          style={{ padding: '7px 14px', borderRadius: '8px', border: `1px solid ${D.border}`, backgroundColor: 'transparent', color: D.textSub, fontSize: '13px', fontWeight: '500', cursor: 'pointer' }}>
          ← Back
        </button>
      </div>

      {/* ── Guest pre-fill banner ── */}
      {prefillGuest && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', marginBottom: '20px', backgroundColor: D.accentFaint, borderRadius: '10px', fontSize: '13px', color: D.accent, fontWeight: '600' }}>
          <span>🎯</span>
          <span>
            Pre-filled from guest <strong>{prefillGuest.influencer?.name ?? 'guest'}</strong>
            {prefillGuest.items?.length > 0 && ` · ${prefillGuest.items.length} item${prefillGuest.items.length !== 1 ? 's' : ''} loaded`}
          </span>
        </div>
      )}

      {/* ── No location warning ── */}
      {!hasEnabledLocation && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '11px 16px', marginBottom: '20px', backgroundColor: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: '10px', fontSize: '13px', color: '#92400E' }}>
          <span>
            {seedingType === 'InStore'
              ? <>⚠ <strong>No store locations configured.</strong> Go to Admin → Locations.</>
              : <>⚠ <strong>No online location enabled.</strong> Go to Admin → Locations.</>
            }
          </span>
          <a href="/portal/admin" style={{ flexShrink: 0, fontWeight: '700', color: '#92400E', textDecoration: 'underline', whiteSpace: 'nowrap' }}>Admin →</a>
        </div>
      )}

      <Form method="post" onSubmit={handleSubmit} ref={formRef}>
        {/* ── Hidden inputs ── */}
        <input type="hidden" name="shop"              value={shop} />
        <input type="hidden" name="influencerId"      value={selectedInfluencer?.id ?? ''} />
        <input type="hidden" name="campaignId"        value={selectedCampaign?.id ?? ''} />
        <input type="hidden" name="seedingType"       value={seedingType} />
        <input type="hidden" name="storeLocationId"   value={selectedStore?.shopifyLocationId ?? ''} />
        <input type="hidden" name="storeLocationName" value={selectedStore?.name ?? ''} />
        <input type="hidden" name="bypassBudget"      value="0" ref={bypassBudgetRef} />
        <input type="hidden" name="guestId"           value={prefillGuest?.id ?? ''} />
        {selectedProducts.map(p => (
          <span key={p.id}>
            <input type="hidden" name="productIds"        value={p.id} />
            <input type="hidden" name="variantIds"        value={p.selectedVariant?.id ?? p.variantId ?? ''} />
            <input type="hidden" name="productNames"      value={p.name} />
            <input type="hidden" name="productPrices"     value={p.selectedVariant?.price ?? p.price ?? 0} />
            <input type="hidden" name="productCosts"      value={p.selectedVariant?.cost ?? p.cost ?? ''} />
            <input type="hidden" name="productImages"     value={p.image ?? ''} />
            <input type="hidden" name="productSizes"      value={p.size ?? ''} />
            <input type="hidden" name="productCategories" value={p.category ?? ''} />
          </span>
        ))}

        <div style={{ display: 'grid', gridTemplateColumns: '272px 1fr', gap: '32px', alignItems: 'start' }}>

          {/* ══════════════════════════════ LEFT PANEL ══════════════════════════════ */}
          <div style={{ position: 'sticky', top: '20px', display: 'flex', flexDirection: 'column', gap: '22px' }}>

            {/* ── Type segmented control ── */}
            <div style={{ display: 'inline-flex', backgroundColor: D.surfaceHigh, borderRadius: '9px', padding: '3px', gap: 0 }}>
              {[
                { key: 'Online',  icon: '🌐', label: t('newSeeding.typeOnline') },
                { key: 'InStore', icon: '🏪', label: t('newSeeding.typeInStore') },
              ].map(({ key, icon, label }) => {
                const active = seedingType === key;
                return (
                  <button key={key} type="button" onClick={() => { setSeedingType(key); setSelectedStore(null); }}
                    style={{
                      flex: 1, padding: '7px 14px', borderRadius: '7px', border: 'none', cursor: 'pointer',
                      fontSize: '13px', fontWeight: active ? '700' : '500',
                      backgroundColor: active ? D.surface : 'transparent',
                      color: active ? D.text : D.textMuted,
                      boxShadow: active ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                      transition: 'all 0.15s',
                      whiteSpace: 'nowrap',
                    }}>
                    {icon} {label}
                  </button>
                );
              })}
            </div>

            {/* ── Influencer section ── */}
            <div>
              <p style={{ margin: '0 0 10px', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.7px', color: D.textMuted }}>
                {t('newSeeding.sidebar.influencer')}
              </p>

              {/* Selected influencer card */}
              {selectedInfluencer && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', marginBottom: '12px', backgroundColor: D.accentFaint, borderRadius: '10px', animation: 'slideUp 0.15s ease' }}>
                  <div style={{ width: '34px', height: '34px', borderRadius: '50%', flexShrink: 0, background: `linear-gradient(135deg, ${D.accent}, ${D.purple})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: '800', color: '#fff' }}>
                    {(selectedInfluencer.handle?.[0] ?? '?').toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: '14px', fontWeight: '700', color: D.accent, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>@{selectedInfluencer.handle}</div>
                    {selectedInfluencer.name && <div style={{ fontSize: '11px', color: D.textSub, marginTop: '1px' }}>{selectedInfluencer.name}</div>}
                  </div>
                  <button type="button" onClick={() => setSelectedInfluencer(null)}
                    style={{ background: 'none', border: 'none', color: D.textMuted, cursor: 'pointer', fontSize: '18px', lineHeight: 1, padding: '2px 4px', flexShrink: 0 }}>×</button>
                </div>
              )}

              {/* Search */}
              <input type="text" placeholder={t('newSeeding.searchInf')} value={infSearch}
                onChange={e => setInfSearch(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', padding: '8px 11px', fontSize: '13px', border: `1px solid ${D.border}`, borderRadius: '8px', backgroundColor: D.bg, color: D.text, outline: 'none', marginBottom: '8px' }} />

              {/* Follower range chips */}
              <div style={{ display: 'flex', gap: '2px', marginBottom: '6px', flexWrap: 'wrap' }}>
                {FOLLOWER_RANGES.map(r => (
                  <Chip key={r.label} label={r.label} active={infFollowerRange === r.label} onClick={() => setInfFollowerRange(r.label)} />
                ))}
              </div>

              {/* Country chips — real flags via flagcdn */}
              {topCountries.length > 0 && (
                <div style={{ display: 'flex', gap: '2px', marginBottom: '10px', flexWrap: 'wrap' }}>
                  <Chip label="All" active={!infCountry} onClick={() => setInfCountry('')} />
                  {topCountries.map(c => {
                    const code = COUNTRY_CODES[c];
                    return (
                      <button key={c} type="button" onClick={() => setInfCountry(infCountry === c ? '' : c)}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: '4px',
                          padding: '3px 8px', fontSize: '11px', fontWeight: infCountry === c ? '700' : '500',
                          borderRadius: '5px', border: 'none',
                          backgroundColor: infCountry === c ? D.accentFaint : 'transparent',
                          color: infCountry === c ? D.accent : D.textMuted,
                          cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.1s',
                        }}>
                        {code ? <FlagImg code={code} size={14} /> : null}
                        <span style={{ marginLeft: code ? '2px' : 0 }}>{c}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Influencer list — clean, no per-row borders */}
              <div className="new-seeding-left" style={{ maxHeight: '252px', overflowY: 'auto', borderRadius: '9px', border: `1px solid ${D.border}`, backgroundColor: D.surface }}>
                {filteredInfluencers.length === 0 ? (
                  <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: '12px', color: D.textMuted }}>
                    {t('newSeeding.noInfFilters')}
                  </div>
                ) : filteredInfluencers.map((inf, idx) => {
                  const isSelected = selectedInfluencer?.id === inf.id;
                  const followers  = fmtFollowers(inf.followers);
                  const code       = COUNTRY_CODES[inf.country];
                  return (
                    <button key={inf.id} type="button"
                      className={isSelected ? 'inf-row inf-row-selected' : 'inf-row'}
                      onClick={() => setSelectedInfluencer(isSelected ? null : inf)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '9px',
                        width: '100%', padding: '9px 12px', cursor: 'pointer', textAlign: 'left',
                        border: 'none',
                        borderTop: idx > 0 ? `1px solid ${D.borderLight}` : 'none',
                        backgroundColor: isSelected ? D.accentFaint : 'transparent',
                        transition: 'background-color 0.1s',
                      }}>
                      {/* Avatar */}
                      <div style={{ width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0, background: isSelected ? `linear-gradient(135deg, ${D.accent}, ${D.purple})` : D.surfaceHigh, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '800', color: isSelected ? '#fff' : D.textSub }}>
                        {(inf.handle?.[0] ?? '?').toUpperCase()}
                      </div>
                      {/* Info */}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: '13px', fontWeight: '600', color: isSelected ? D.accent : D.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.3 }}>
                          @{inf.handle}
                        </div>
                        {inf.name && (
                          <div style={{ fontSize: '11px', color: D.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.3 }}>
                            {inf.name}
                          </div>
                        )}
                      </div>
                      {/* Right meta */}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px', flexShrink: 0 }}>
                        {followers && <span style={{ fontSize: '10px', fontWeight: '600', color: D.textMuted }}>{followers}</span>}
                        {code && <FlagImg code={code} size={14} />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Campaign ── */}
            {campaigns.length > 0 && (
              <div>
                <p style={{ margin: '0 0 8px', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.7px', color: D.textMuted }}>
                  {t('newSeeding.campaign')} <span style={{ fontWeight: '400', textTransform: 'none', opacity: 0.6 }}>{t('newSeeding.campaignOptional')}</span>
                </p>
                <select
                  value={selectedCampaign?.id ?? ''}
                  onChange={e => {
                    const id = e.target.value;
                    setSelectedCampaign(id ? campaigns.find(c => c.id === parseInt(id)) ?? null : null);
                  }}
                  style={{ width: '100%', padding: '8px 11px', fontSize: '13px', border: `1px solid ${D.border}`, borderRadius: '8px', backgroundColor: D.bg, color: D.text, outline: 'none', cursor: 'pointer' }}>
                  <option value="">No campaign</option>
                  {campaigns.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </div>
            )}

            {/* ── Store picker (in-store only) ── */}
            {seedingType === 'InStore' && (
              <div>
                <p style={{ margin: '0 0 8px', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.7px', color: D.textMuted }}>
                  {t('newSeeding.storeLocation')} <span style={{ color: D.errorText }}>*</span>
                </p>
                {storeLocations.length === 0 ? (
                  <p style={{ margin: 0, fontSize: '12px', color: '#92400E' }}>{t('newSeeding.noStoresConfigured')}</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {storeLocations.map(loc => {
                      const active = selectedStore?.id === loc.id;
                      return (
                        <button key={loc.id} type="button" onClick={() => setSelectedStore(loc)}
                          style={{ textAlign: 'left', padding: '9px 12px', borderRadius: '8px', border: `1.5px solid ${active ? D.accent : D.border}`, backgroundColor: active ? D.accentFaint : 'transparent', color: active ? D.accent : D.text, cursor: 'pointer', fontSize: '13px', fontWeight: active ? '700' : '500', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span>🏪 {loc.name}</span>
                          {active && <span style={{ fontSize: '11px' }}>✓</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── Notes ── */}
            <div>
              <p style={{ margin: '0 0 6px', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.7px', color: D.textMuted }}>
                {t('newSeeding.notes')} <span style={{ fontWeight: '400', textTransform: 'none', opacity: 0.6 }}>{t('newSeeding.notesOptional')}</span>
              </p>
              <textarea name="notes" value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                placeholder={t('newSeeding.notesPlaceholder')}
                style={{ width: '100%', boxSizing: 'border-box', padding: '8px 11px', fontSize: '12px', border: `1px solid ${D.border}`, borderRadius: '8px', backgroundColor: D.bg, color: D.text, resize: 'vertical', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5 }} />
            </div>

          </div>
          {/* ════════════════════════════════ END LEFT ════════════════════════════════ */}

          {/* ══════════════════════════════ RIGHT PANEL ══════════════════════════════ */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault(); setDragOver(false);
              const prod = products.find(p => p.id === dragProductId);
              if (prod) handleDrop(prod);
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
          >

            {/* ── Product browser ── */}
            <div style={{ backgroundColor: D.surface, borderRadius: '14px', border: `1px solid ${dragOver ? D.accent : D.border}`, overflow: 'hidden', transition: 'border-color 0.15s', boxShadow: dragOver ? `0 0 0 3px ${D.accentFaint}` : 'none' }}>
              {/* Toolbar */}
              <div style={{ padding: '14px 16px', borderBottom: `1px solid ${D.border}`, display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                <input type="text" placeholder={t('newSeeding.searchProducts')} value={search}
                  onChange={e => setSearch(e.target.value)}
                  style={{ flex: 1, minWidth: '160px', padding: '8px 11px', fontSize: '13px', border: `1px solid ${D.border}`, borderRadius: '8px', backgroundColor: D.bg, color: D.text, outline: 'none' }} />
                {collections.length > 0 && (
                  <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                    <Chip label="All" active={!selectedCollection} onClick={() => setSelectedCollection(null)} />
                    {collections.map(c => (
                      <Chip key={c.id} label={c.title}
                        active={selectedCollection?.id === c.id}
                        onClick={() => setSelectedCollection(selectedCollection?.id === c.id ? null : c)} />
                    ))}
                  </div>
                )}
              </div>

              {productsError && (
                <div style={{ padding: '10px 16px', backgroundColor: '#FFF7ED', color: '#92400E', fontSize: '12px' }}>
                  ⚠ {productsError}
                </div>
              )}

              {/* Product grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px', padding: '16px', maxHeight: '420px', overflowY: 'auto' }}>
                {!productsError && filteredProducts.length === 0 && (
                  <div style={{ gridColumn: '1 / -1', padding: '48px 16px', textAlign: 'center', color: D.textMuted }}>
                    <div style={{ fontSize: '28px', marginBottom: '8px' }}>🛍</div>
                    <div style={{ fontSize: '13px', fontWeight: '500' }}>
                      {products.length === 0 ? t('newSeeding.noProductsInShopify') : t('newSeeding.noProducts')}
                    </div>
                  </div>
                )}
                {filteredProducts.map(prod => {
                  const outOfStock   = hasEnabledLocation && prod.stock === 0;
                  const recentlySent = !!(selectedInfluencer && recentlySeedMapForInfluencer[prod.id]);
                  const alreadyAdded = selectedProducts.some(p => p.id === prod.id);
                  const isShaking    = shakeId === prod.id;
                  const blocked      = outOfStock || recentlySent;
                  return (
                    <div key={prod.id}
                      draggable={!blocked}
                      onDragStart={() => setDragProductId(prod.id)}
                      onDragEnd={() => setDragProductId(null)}
                      onClick={() => { if (!blocked && !alreadyAdded) handleDrop(prod); }}
                      className={blocked || alreadyAdded ? '' : 'prod-card'}
                      style={{
                        borderRadius: '10px', overflow: 'hidden',
                        cursor: blocked ? 'not-allowed' : alreadyAdded ? 'default' : 'pointer',
                        opacity: blocked ? 0.35 : 1,
                        backgroundColor: alreadyAdded ? D.accentFaint : D.bg,
                        border: alreadyAdded ? `1.5px solid ${D.accent}` : `1px solid ${D.border}`,
                        animation: isShaking ? 'shake 0.4s' : 'none',
                        position: 'relative',
                      }}>
                      {/* Selected checkmark */}
                      {alreadyAdded && (
                        <div style={{ position: 'absolute', top: '7px', right: '7px', width: '20px', height: '20px', borderRadius: '50%', backgroundColor: D.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#fff', fontWeight: '800', zIndex: 1 }}>✓</div>
                      )}
                      {prod.image
                        ? <img src={prod.image} alt={prod.name} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }} />
                        : <div style={{ width: '100%', aspectRatio: '1', backgroundColor: D.surfaceHigh, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px' }}>📦</div>
                      }
                      <div style={{ padding: '8px 10px' }}>
                        <div style={{ fontSize: '11px', fontWeight: '600', color: alreadyAdded ? D.accent : D.text, lineHeight: 1.3, marginBottom: '3px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                          {prod.name}
                        </div>
                        <div style={{ fontSize: '11px', color: D.textMuted, fontWeight: '500' }}>€{prod.price.toFixed(2)}</div>
                        {recentlySent && <div style={{ fontSize: '10px', color: D.accent, fontWeight: '700', marginTop: '2px' }}>Recently sent</div>}
                        {outOfStock   && <div style={{ fontSize: '10px', color: D.errorText, fontWeight: '600', marginTop: '2px' }}>Out of stock</div>}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Drag hint */}
              {dragOver && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', backgroundColor: 'rgba(124,111,247,0.04)', fontSize: '13px', fontWeight: '700', color: D.accent }}>
                  Drop to add
                </div>
              )}
            </div>

            {/* ── Selected items + CTA (sticky cart) ── */}
            <div style={{ position: 'sticky', bottom: '16px', backgroundColor: D.surface, borderRadius: '14px', border: `1px solid ${D.border}`, boxShadow: '0 8px 32px rgba(0,0,0,0.10)', overflow: 'hidden' }}>

              {/* Items list */}
              {selectedProducts.length > 0 && (
                <div style={{ maxHeight: '220px', overflowY: 'auto', borderBottom: `1px solid ${D.border}` }}>
                  {selectedProducts.map((prod, idx) => (
                    <div key={prod.id} style={{ display: 'grid', gridTemplateColumns: '36px 1fr auto auto auto', gap: '10px', alignItems: 'center', padding: '10px 14px', borderTop: idx > 0 ? `1px solid ${D.borderLight}` : 'none', animation: 'slideUp 0.15s ease' }}>
                      {/* Image */}
                      {prod.image
                        ? <img src={prod.image} alt={prod.name} style={{ width: '36px', height: '36px', objectFit: 'cover', borderRadius: '7px' }} />
                        : <div style={{ width: '36px', height: '36px', backgroundColor: D.surfaceHigh, borderRadius: '7px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px' }}>📦</div>
                      }
                      {/* Name */}
                      <div style={{ fontSize: '12px', fontWeight: '600', color: D.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{prod.name}</div>
                      {/* Size selector */}
                      {prod.variants && prod.variants.length > 1 ? (
                        <select
                          value={prod.size ?? ''}
                          onChange={e => {
                            const size    = e.target.value;
                            const variant = prod.variants.find(v => extractSizeFromVariant(v.title) === size);
                            setSelectedProducts(prev => prev.map(p =>
                              p.id === prod.id ? { ...p, size, selectedVariant: variant ?? p.selectedVariant, sizeUnavailable: false } : p
                            ));
                          }}
                          style={{ fontSize: '12px', padding: '4px 8px', borderRadius: '6px', border: `1px solid ${!prod.size ? D.errorText : D.border}`, backgroundColor: !prod.size ? '#FFF1F0' : D.bg, color: D.text, outline: 'none', cursor: 'pointer' }}>
                          <option value="">{t('newSeeding.pickSize')}</option>
                          {prod.variants.map(v => {
                            const label = extractSizeFromVariant(v.title) || v.title;
                            return <option key={v.id} value={extractSizeFromVariant(v.title)}>{label}{v.available === false ? ' (OOS)' : ''}</option>;
                          })}
                        </select>
                      ) : (
                        <span style={{ fontSize: '11px', color: D.textMuted, backgroundColor: D.surfaceHigh, padding: '3px 8px', borderRadius: '5px', whiteSpace: 'nowrap' }}>{t('newSeeding.oneSize')}</span>
                      )}
                      {/* Price */}
                      <span style={{ fontSize: '12px', fontWeight: '600', color: D.textSub, whiteSpace: 'nowrap' }}>€{(prod.selectedVariant?.price ?? prod.price).toFixed(2)}</span>
                      {/* Remove */}
                      <button type="button"
                        onClick={() => setSelectedProducts(prev => prev.filter(p => p.id !== prod.id))}
                        style={{ background: 'none', border: 'none', color: D.textMuted, cursor: 'pointer', fontSize: '17px', lineHeight: 1, padding: '2px', flexShrink: 0 }}
                        onMouseOver={e => e.currentTarget.style.color = '#EF4444'}
                        onMouseOut={e => e.currentTarget.style.color = D.textMuted}>×</button>
                    </div>
                  ))}
                </div>
              )}

              {/* Budget warning */}
              {actionData?.budgetWarning && (
                <div style={{ padding: '12px 16px', backgroundColor: 'rgba(245,158,11,0.07)', borderBottom: `1px solid rgba(245,158,11,0.2)` }}>
                  <div style={{ fontSize: '12px', fontWeight: '700', color: '#92400E', marginBottom: '6px' }}>⚠ Budget exceeded</div>
                  <div style={{ fontSize: '12px', color: '#92400E', marginBottom: '8px', lineHeight: 1.5 }}>{actionData.budgetMessage}</div>
                  <button type="button"
                    onClick={() => { if (bypassBudgetRef.current) bypassBudgetRef.current.value = '1'; setSubmitting(true); formRef.current?.submit(); }}
                    style={{ padding: '6px 14px', borderRadius: '7px', border: '1px solid #D97706', backgroundColor: 'transparent', color: '#92400E', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>
                    Proceed anyway →
                  </button>
                </div>
              )}

              {/* Allocation / submit errors */}
              {(submitError || (actionData?.error && !actionData?.budgetWarning)) && (
                <div style={{ padding: '10px 16px', backgroundColor: D.errorBg, color: D.errorText, fontSize: '12px', fontWeight: '600', borderBottom: `1px solid ${D.border}` }}>
                  {submitError || actionData?.error}
                </div>
              )}

              {/* Footer: total + CTA */}
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '14px' }}>
                {selectedProducts.length > 0 && (
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '11px', color: D.textMuted }}>{selectedProducts.length} item{selectedProducts.length !== 1 ? 's' : ''}</div>
                    <div style={{ fontSize: '17px', fontWeight: '800', color: D.text, letterSpacing: '-0.4px' }}>€{totalRetail.toFixed(2)}</div>
                    {selectedProducts.some(p => p.selectedVariant?.cost || p.cost) && (
                      <div style={{ fontSize: '11px', color: D.textMuted }}>Cost: €{selectedProducts.reduce((s, p) => s + (p.selectedVariant?.cost ?? p.cost ?? 0), 0).toFixed(2)}</div>
                    )}
                  </div>
                )}
                {selectedProducts.length === 0 && (
                  <div style={{ flex: 1, fontSize: '13px', color: D.textMuted }}>Click products above to add them</div>
                )}
                <button type="submit" disabled={!canSubmit}
                  style={{
                    padding: '11px 22px', borderRadius: '10px', border: 'none', flexShrink: 0,
                    background: canSubmit ? `linear-gradient(135deg, ${D.accent} 0%, ${D.purple} 100%)` : D.surfaceHigh,
                    color: canSubmit ? '#fff' : D.textMuted,
                    fontSize: '13px', fontWeight: '700',
                    cursor: canSubmit ? 'pointer' : 'not-allowed',
                    boxShadow: canSubmit ? '0 4px 16px rgba(124,111,247,0.28)' : 'none',
                    transition: 'all 0.2s ease',
                    letterSpacing: '-0.1px', whiteSpace: 'nowrap',
                  }}>
                  {ctaLabel}
                </button>
              </div>
            </div>
            {/* ══ END STICKY CART ══ */}

          </div>
          {/* ════════════════════════════════ END RIGHT ════════════════════════════════ */}

        </div>
      </Form>
    </div>
  );
}
