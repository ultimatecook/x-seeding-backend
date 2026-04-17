/**
 * Portal version of New Seeding.
 * Fetches Shopify products using the stored offline access token — no Shopify admin session needed.
 */
import { useState, useEffect } from 'react';
import { useLoaderData, Form, useNavigate, redirect } from 'react-router';
import prisma from '../db.server';
import { requirePortalUser } from '../utils/portal-auth.server';
import { requirePermission } from '../utils/portal-permissions.js';
import { audit } from '../utils/audit.server.js';
import { fmtNum } from '../theme';
import { D, Pbtn as btn, Pinput as input } from '../utils/portal-theme';
import { guessProductCategory, extractSizeFromVariant } from '../utils/size-helpers';
import { assignDiscountCodes } from '../utils/discount-codes.server';
import { getPrimaryLocationId } from '../utils/inventory.server';

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

  return { products, productsError, collections: collectionsData, influencers, campaigns, recentlySeededMap, allSavedSizes, shop };
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

  const productsWithoutSize = productSizes.filter(s => !s || s.trim() === '');
  if (productsWithoutSize.length > 0) {
    return { error: 'All products must have a size selected.' };
  }

  const influencer = await prisma.influencer.findUnique({ where: { id: influencerId } });
  if (!influencer || influencer.shop !== shop) return { error: 'Influencer not found.' };

  let shopifyDraftOrderId = null;
  let shopifyOrderName    = null;
  let invoiceUrl          = null;

  try {
    let session = await prisma.session.findFirst({ where: { shop, isOnline: false, expires: null } });
    if (!session) session = await prisma.session.findFirst({ where: { shop, isOnline: false }, orderBy: { expires: 'desc' } });
    if (!session) session = await prisma.session.findFirst({ where: { shop }, orderBy: { expires: 'desc' } });
    if (session?.accessToken) {
      const locationId = await getPrimaryLocationId(shop);
      const lineItems  = variantIds.filter(v => v && v.length > 0).map(variantId => ({ variantId, quantity: 1 }));
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
      // Route inventory to the chosen location if one is configured
      if (locationId) draftInput.locationId = locationId;

      const res  = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': session.accessToken },
        body: JSON.stringify({ query: mutation, variables: { input: draftInput } }),
      });
      const body  = await res.json();
      const draft = body?.data?.draftOrderCreate?.draftOrder;
      if (draft) {
        shopifyDraftOrderId = draft.id;
        shopifyOrderName    = draft.name;
        invoiceUrl          = draft.invoiceUrl;
      }
    }
  } catch (err) {
    console.error('Portal: failed to create Shopify draft order:', err.message);
  }

  const seeding = await prisma.seeding.create({
    data: {
      shop, influencerId, campaignId, totalCost, notes, status: 'Pending',
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

  // Assign discount codes from pool (best-effort — won't fail seeding creation)
  try {
    await assignDiscountCodes(shop, seeding.id);
  } catch (e) {
    console.warn('Portal: could not assign discount codes:', e.message);
  }

  await audit({
    shop, portalUser,
    action: 'created_seeding',
    entityType: 'seeding',
    entityId: seeding.id,
    detail: `Created seeding for ${influencer?.handle ?? influencerId} (${productIds.length} product${productIds.length !== 1 ? 's' : ''}, €${totalCost.toFixed(2)})`,
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
function countryFlag(name) {
  const code = COUNTRY_CODES[name];
  if (!code) return '🌍';
  return [...code].map(c => String.fromCodePoint(0x1F1E0 + c.charCodeAt(0) - 65)).join('');
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

function Pill({ label, active, onClick }) {
  return (
    <button type="button" onClick={onClick} style={{
      padding: '3px 10px', fontSize: '11px', fontWeight: '600', borderRadius: '20px',
      border: `1.5px solid ${active ? D.accent : D.border}`,
      backgroundColor: active ? D.accentLight : 'transparent',
      color: active ? D.accent : D.textSub,
      cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.12s',
    }}>{label}</button>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function PortalNewSeeding() {
  const { products, productsError, collections, influencers, campaigns, recentlySeededMap, allSavedSizes, shop } = useLoaderData();
  const navigate = useNavigate();

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
  const canSubmit    = !submitting && selectedInfluencer && selectedProducts.length > 0 && allHaveSizes;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!selectedInfluencer)          { setSubmitError('Select an influencer first.'); return; }
    if (selectedProducts.length === 0){ setSubmitError('Add at least one product.'); return; }
    if (!allHaveSizes)                { setSubmitError('All products must have a size selected.'); return; }
    setSubmitting(true);
    setSubmitError(null);
    e.target.submit();
  }

  return (
    <div>
      <style>{`
        @keyframes shake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-4px)} 40%{transform:translateX(4px)} 60%{transform:translateX(-3px)} 80%{transform:translateX(3px)} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(5px)} to{opacity:1;transform:translateY(0)} }
        .inf-row:hover { background: ${D.surfaceHigh} !important; }
        .inf-row-active:hover { background: ${D.accentLight} !important; }
        .prod-tile { transition: transform 0.12s ease, box-shadow 0.12s ease; }
        .prod-tile:hover { transform: scale(1.025); box-shadow: 0 4px 14px rgba(0,0,0,0.08); }
      `}</style>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: D.text, letterSpacing: '-0.3px' }}>New Seeding</h2>
          <p style={{ margin: '3px 0 0', fontSize: '13px', color: D.textMuted }}>Send products to an influencer</p>
        </div>
        <button type="button" onClick={() => navigate('/portal/seedings')} style={{ ...btn.ghost, fontSize: '13px' }}>← Back</button>
      </div>

      <Form method="post" onSubmit={handleSubmit}>
        {/* Hidden inputs */}
        <input type="hidden" name="shop"         value={shop} />
        <input type="hidden" name="influencerId" value={selectedInfluencer?.id ?? ''} />
        <input type="hidden" name="campaignId"   value={selectedCampaign?.id ?? ''} />
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

        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '20px', alignItems: 'start' }}>

          {/* ══ LEFT SIDEBAR ══ */}
          <div style={{ backgroundColor: D.surface, border: `1px solid ${D.border}`, borderRadius: '14px', overflow: 'hidden', position: 'sticky', top: '16px' }}>

            {/* ── Influencer section ── */}
            <div style={{ padding: '16px 16px 0' }}>
              <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.6px', color: D.textMuted, marginBottom: '10px' }}>Influencer</div>

              <input type="text" placeholder="Search…" value={infSearch}
                onChange={e => setInfSearch(e.target.value)}
                style={{ ...input.base, width: '100%', boxSizing: 'border-box', fontSize: '13px', marginBottom: '8px' }} />

              {/* Follower range */}
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '6px' }}>
                {FOLLOWER_RANGES.map(r => (
                  <Pill key={r.label} label={r.label}
                    active={infFollowerRange === r.label}
                    onClick={() => setInfFollowerRange(r.label)} />
                ))}
              </div>

              {/* Country pills */}
              {topCountries.length > 0 && (
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '10px' }}>
                  <Pill label="All" active={!infCountry} onClick={() => setInfCountry('')} />
                  {topCountries.map(c => (
                    <Pill key={c} label={`${countryFlag(c)} ${c}`}
                      active={infCountry === c}
                      onClick={() => setInfCountry(infCountry === c ? '' : c)} />
                  ))}
                </div>
              )}
            </div>

            {/* Influencer list */}
            <div style={{ maxHeight: '260px', overflowY: 'auto', borderTop: `1px solid ${D.borderLight}` }}>
              {filteredInfluencers.length === 0 ? (
                <div style={{ padding: '20px 16px', textAlign: 'center', fontSize: '12px', color: D.textMuted }}>
                  No influencers match your filters
                </div>
              ) : filteredInfluencers.map(inf => {
                const isSelected = selectedInfluencer?.id === inf.id;
                const followers  = fmtFollowers(inf.followers);
                return (
                  <button key={inf.id} type="button"
                    className={isSelected ? 'inf-row inf-row-active' : 'inf-row'}
                    onClick={() => setSelectedInfluencer(inf)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      width: '100%', padding: '9px 14px', cursor: 'pointer', textAlign: 'left',
                      border: 'none', borderBottom: `1px solid ${D.borderLight}`,
                      backgroundColor: isSelected ? D.accentLight : 'transparent',
                      transition: 'background-color 0.1s',
                    }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                      <div style={{
                        width: '26px', height: '26px', borderRadius: '50%', flexShrink: 0,
                        background: `linear-gradient(135deg, ${D.accent}, ${D.purple})`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '10px', fontWeight: '800', color: '#fff',
                      }}>
                        {(inf.handle?.[0] ?? '?').toUpperCase()}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: isSelected ? '700' : '600', color: isSelected ? D.accent : D.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          @{inf.handle}
                        </div>
                        {inf.name && (
                          <div style={{ fontSize: '11px', color: D.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {inf.name}
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '1px', flexShrink: 0, marginLeft: '8px' }}>
                      {isSelected && <span style={{ fontSize: '10px', fontWeight: '800', color: D.accent }}>✓</span>}
                      {followers && <span style={{ fontSize: '10px', fontWeight: '600', color: D.textSub }}>{followers}</span>}
                      {inf.country && <span style={{ fontSize: '10px', color: D.textMuted }}>{inf.country}</span>}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* ── Campaign section ── */}
            {campaigns.length > 0 && (
              <div style={{ padding: '12px 16px', borderTop: `1px solid ${D.border}` }}>
                <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.6px', color: D.textMuted, marginBottom: '8px' }}>
                  Campaign <span style={{ fontWeight: '400', textTransform: 'none', color: D.textMuted, opacity: 0.7 }}>— optional</span>
                </div>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  <Pill label="None" active={!selectedCampaign} onClick={() => setSelectedCampaign(null)} />
                  {campaigns.map(c => (
                    <Pill key={c.id} label={c.title}
                      active={selectedCampaign?.id === c.id}
                      onClick={() => setSelectedCampaign(selectedCampaign?.id === c.id ? null : c)} />
                  ))}
                </div>
              </div>
            )}

            {/* ── Notes section ── */}
            <div style={{ padding: '12px 16px', borderTop: `1px solid ${D.border}` }}>
              <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.6px', color: D.textMuted, marginBottom: '6px' }}>
                Notes <span style={{ fontWeight: '400', textTransform: 'none', opacity: 0.7 }}>— optional</span>
              </div>
              <textarea name="notes" value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                placeholder="Content direction, brief, notes…"
                style={{ ...input.base, width: '100%', resize: 'vertical', boxSizing: 'border-box', fontSize: '12px' }} />
            </div>

            {/* ── CTA ── */}
            <div style={{ padding: '12px 16px', borderTop: `1px solid ${D.border}` }}>
              {submitError && (
                <div style={{ marginBottom: '8px', padding: '8px 12px', backgroundColor: D.errorBg, color: D.errorText, borderRadius: '7px', fontSize: '12px', fontWeight: '600' }}>
                  {submitError}
                </div>
              )}
              <button type="submit" disabled={!canSubmit}
                style={{
                  width: '100%',
                  padding: '13px',
                  borderRadius: '10px',
                  border: 'none',
                  background: canSubmit
                    ? `linear-gradient(135deg, ${D.accent} 0%, ${D.purple} 100%)`
                    : D.surfaceHigh,
                  color: canSubmit ? '#fff' : D.textMuted,
                  fontSize: '14px',
                  fontWeight: '700',
                  cursor: canSubmit ? 'pointer' : 'not-allowed',
                  boxShadow: canSubmit ? '0 4px 16px rgba(124,111,247,0.3)' : 'none',
                  transition: 'all 0.2s ease',
                  letterSpacing: '-0.1px',
                }}>
                {submitting
                  ? 'Creating…'
                  : selectedProducts.length > 0
                    ? `🚀 Create Seeding (${selectedProducts.length})`
                    : 'Create Seeding'}
              </button>

              {/* Validation hints */}
              {!selectedInfluencer && (
                <p style={{ margin: '6px 0 0', fontSize: '11px', color: D.textMuted, textAlign: 'center' }}>Select an influencer to continue</p>
              )}
              {selectedInfluencer && selectedProducts.length > 0 && !allHaveSizes && (
                <p style={{ margin: '6px 0 0', fontSize: '11px', color: D.errorText, textAlign: 'center', fontWeight: '600' }}>⚠️ All products need a size</p>
              )}
            </div>
          </div>

          {/* ══ RIGHT: products + basket ══ */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

            {/* ── Product browser ── */}
            <div style={{ backgroundColor: D.surface, border: `1px solid ${D.border}`, borderRadius: '14px', overflow: 'hidden' }}>
              {/* Toolbar */}
              <div style={{ padding: '14px 16px', borderBottom: `1px solid ${D.border}`, display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                <input type="text" placeholder="Search products…" value={search}
                  onChange={e => setSearch(e.target.value)}
                  style={{ ...input.base, flex: '1', minWidth: '160px', fontSize: '13px' }} />
                {collections.length > 0 && (
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    <Pill label="All" active={!selectedCollection} onClick={() => setSelectedCollection(null)} />
                    {collections.map(c => (
                      <Pill key={c.id} label={c.title}
                        active={selectedCollection?.id === c.id}
                        onClick={() => setSelectedCollection(selectedCollection?.id === c.id ? null : c)} />
                    ))}
                  </div>
                )}
              </div>

              {productsError && (
                <div style={{ padding: '10px 16px', backgroundColor: D.warningBg, color: D.warningText, fontSize: '13px' }}>
                  ⚠️ {productsError}
                </div>
              )}

              {/* Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '10px', padding: '14px 16px', maxHeight: '400px', overflowY: 'auto' }}>
                {!productsError && filteredProducts.length === 0 && (
                  <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '32px 16px', color: D.textMuted, fontSize: '13px' }}>
                    {products.length === 0
                      ? 'No products found in your Shopify store.'
                      : `No products match${search ? ` "${search}"` : ''}.`}
                  </div>
                )}
                {filteredProducts.map(prod => {
                  const outOfStock   = prod.stock === 0;
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
                      className={blocked || alreadyAdded ? '' : 'prod-tile'}
                      style={{
                        border: `${alreadyAdded ? '2px' : '1px'} solid ${alreadyAdded ? D.accent : D.border}`,
                        borderRadius: '10px', overflow: 'hidden',
                        cursor: blocked ? 'not-allowed' : alreadyAdded ? 'default' : 'pointer',
                        opacity: blocked ? 0.4 : 1,
                        backgroundColor: alreadyAdded ? D.accentLight : D.surface,
                        animation: isShaking ? 'shake 0.4s' : 'none',
                        position: 'relative',
                      }}>
                      {alreadyAdded && (
                        <div style={{ position: 'absolute', top: '5px', right: '5px', width: '18px', height: '18px', borderRadius: '50%', backgroundColor: D.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#fff', fontWeight: '800' }}>✓</div>
                      )}
                      {prod.image
                        ? <img src={prod.image} alt={prod.name} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }} />
                        : <div style={{ width: '100%', aspectRatio: '1', backgroundColor: D.surfaceHigh, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '26px' }}>📦</div>
                      }
                      <div style={{ padding: '7px 8px' }}>
                        <div style={{ fontSize: '11px', fontWeight: '700', color: alreadyAdded ? D.accent : D.text, lineHeight: 1.3, marginBottom: '2px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{prod.name}</div>
                        <div style={{ fontSize: '10px', color: D.textMuted }}>€{prod.price.toFixed(2)}</div>
                        {recentlySent && <div style={{ fontSize: '9px', color: D.accent, fontWeight: '700', marginTop: '2px' }}>Recently sent</div>}
                        {outOfStock   && <div style={{ fontSize: '9px', color: D.errorText, fontWeight: '700', marginTop: '2px' }}>Out of stock</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Selected items / drop zone ── */}
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => {
                e.preventDefault(); setDragOver(false);
                const prod = products.find(p => p.id === dragProductId);
                if (prod) handleDrop(prod);
              }}
              style={{
                backgroundColor: dragOver ? D.accentLight : D.surface,
                border: `1.5px solid ${dragOver ? D.accent : D.border}`,
                borderRadius: '14px',
                overflow: 'hidden',
                transition: 'all 0.15s ease',
                boxShadow: dragOver ? `0 0 0 3px ${D.accentLight}` : 'none',
              }}
            >
              {/* Panel header */}
              <div style={{ padding: '12px 16px', borderBottom: `1px solid ${selectedProducts.length > 0 ? D.border : 'transparent'}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '12px', fontWeight: '700', color: D.text }}>Selected items</span>
                {selectedProducts.length > 0 && (
                  <span style={{ fontSize: '11px', fontWeight: '700', backgroundColor: D.accent, color: '#fff', borderRadius: '10px', padding: '1px 8px' }}>
                    {selectedProducts.length}
                  </span>
                )}
              </div>

              {selectedProducts.length === 0 ? (
                <div style={{ padding: '28px 16px', textAlign: 'center', color: dragOver ? D.accent : D.textMuted, transition: 'color 0.15s' }}>
                  <div style={{ fontSize: '24px', marginBottom: '6px', transform: dragOver ? 'scale(1.15)' : 'scale(1)', transition: 'transform 0.15s' }}>📦</div>
                  <div style={{ fontSize: '13px', fontWeight: dragOver ? '700' : '500' }}>
                    {dragOver ? 'Drop here' : 'Click or drag products to add them'}
                  </div>
                  {!dragOver && <div style={{ fontSize: '12px', marginTop: '3px', opacity: 0.7 }}>Select an influencer first to auto-fill sizes</div>}
                </div>
              ) : (
                <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '7px' }}>
                  {selectedProducts.map(prod => (
                    <div key={prod.id} style={{
                      display: 'grid', gridTemplateColumns: '38px 1fr auto', gap: '10px', alignItems: 'center',
                      backgroundColor: D.surfaceRaised, border: `1px solid ${D.border}`, borderRadius: '10px', padding: '9px 10px',
                      animation: 'fadeIn 0.18s ease',
                    }}>
                      {prod.image
                        ? <img src={prod.image} alt={prod.name} style={{ width: '38px', height: '38px', objectFit: 'cover', borderRadius: '6px' }} />
                        : <div style={{ width: '38px', height: '38px', backgroundColor: D.surfaceHigh, borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px' }}>📦</div>
                      }
                      <div>
                        <div style={{ fontSize: '12px', fontWeight: '700', color: D.text, marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{prod.name}</div>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
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
                              style={{ fontSize: '12px', padding: '3px 7px', borderRadius: '6px', border: `1px solid ${!prod.size ? D.errorText : D.border}`, backgroundColor: !prod.size ? D.errorBg : D.surface, color: D.text }}>
                              <option value="">Pick size…</option>
                              {prod.variants.map(v => {
                                const label = extractSizeFromVariant(v.title) || v.title;
                                return (
                                  <option key={v.id} value={extractSizeFromVariant(v.title)}>
                                    {label}{v.available === false ? ' (OOS)' : ''}
                                  </option>
                                );
                              })}
                            </select>
                          ) : (
                            <span style={{ fontSize: '11px', color: D.textMuted, backgroundColor: D.surfaceHigh, padding: '2px 7px', borderRadius: '5px' }}>One size</span>
                          )}
                          <span style={{ fontSize: '11px', color: D.textSub, fontWeight: '600' }}>€{(prod.selectedVariant?.price ?? prod.price).toFixed(2)}</span>
                        </div>
                      </div>
                      <button type="button"
                        onClick={() => setSelectedProducts(prev => prev.filter(p => p.id !== prod.id))}
                        style={{ background: 'none', border: 'none', color: D.textMuted, cursor: 'pointer', fontSize: '18px', lineHeight: 1, padding: '4px', transition: 'color 0.12s' }}
                        onMouseOver={e => e.currentTarget.style.color = '#EF4444'}
                        onMouseOut={e => e.currentTarget.style.color = D.textMuted}
                      >×</button>
                    </div>
                  ))}

                  {/* Total row */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '16px', paddingTop: '8px', borderTop: `1px solid ${D.border}`, marginTop: '2px' }}>
                    {selectedProducts.some(p => p.selectedVariant?.cost || p.cost) && (
                      <span style={{ fontSize: '12px', color: D.textSub }}>
                        Cost: <strong style={{ color: D.text }}>€{selectedProducts.reduce((s, p) => s + (p.selectedVariant?.cost ?? p.cost ?? 0), 0).toFixed(2)}</strong>
                      </span>
                    )}
                    <span style={{ fontSize: '14px', fontWeight: '800', color: D.text }}>
                      Retail: €{totalRetail.toFixed(2)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </Form>
    </div>
  );
}
