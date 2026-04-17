import { useState, useEffect } from 'react';
import { useLoaderData, useRouteLoaderData, useNavigate, Form, redirect, useRouteError } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import { authenticate } from '../shopify.server';
import prisma from '../db.server';
import { C, btn, input, fmtNum } from '../theme';
import { guessProductCategory, extractSizeFromVariant, getProductsWithoutSize } from '../utils/size-helpers';

// ── Loader ───────────────────────────────────────────────────────────────────
export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const influencers = await prisma.influencer.findMany({
    where:   { shop, archived: false },
    orderBy: { name: 'asc' },
  });
  const campaigns = await prisma.campaign.findMany({
    where:   { shop },
    orderBy: { createdAt: 'desc' },
    include: { products: true },
  });

  // Load recent seedings (last 90 days) to power duplicate protection
  const since = new Date();
  since.setDate(since.getDate() - 90);
  const recentSeedings = await prisma.seeding.findMany({
    where:   { shop, createdAt: { gte: since } },
    select:  { influencerId: true, products: { select: { productId: true } }, createdAt: true },
  });

  // Build map: influencerId → Set of productIds seeded recently
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

  // Load all saved sizes upfront — keyed by influencerId → { category: size }
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

  return { influencers, campaigns, recentlySeededMap, allSavedSizes };
}

// ── Action ───────────────────────────────────────────────────────────────────
export async function action({ request }) {
  const formData = await request.formData();
  const influencerId  = parseInt(formData.get('influencerId'));
  const shop          = formData.get('shop') || '';
  const campaignIdRaw = formData.get('campaignId');
  const campaignId    = campaignIdRaw ? parseInt(campaignIdRaw) : null;
  const productIds    = formData.getAll('productIds');
  const variantIds    = formData.getAll('variantIds');
  const productNames  = formData.getAll('productNames');
  const productPrices = formData.getAll('productPrices').map(Number);
  const productCosts  = formData.getAll('productCosts').map(v => v ? Number(v) : null);
  const productImages = formData.getAll('productImages');
  const productSizes  = formData.getAll('productSizes');
  const productCategories = formData.getAll('productCategories');
  const totalCost     = productPrices.reduce((sum, p) => sum + p, 0);
  const notes         = formData.get('notes') || '';

  // Validate all products have sizes
  const productsWithoutSize = productSizes.filter(s => !s || s.trim() === '');
  if (productsWithoutSize.length > 0) {
    return new Response(JSON.stringify({ error: 'All products must have a size selected' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const influencer = await prisma.influencer.findUnique({ where: { id: influencerId } });

  let shopifyDraftOrderId = null;
  let shopifyOrderName    = null;
  let invoiceUrl          = null;

  try {
    const session = await prisma.session.findFirst({ where: { shop }, orderBy: { expires: 'desc' } });
    if (session?.accessToken) {
      const lineItems = variantIds.filter(v => v && v.length > 0).map(variantId => ({ variantId, quantity: 1 }));
      const mutation = `
        mutation DraftOrderCreate($input: DraftOrderInput!) {
          draftOrderCreate(input: $input) {
            draftOrder { id name invoiceUrl }
            userErrors { field message }
          }
        }
      `;
      const variables = {
        input: {
          lineItems,
          appliedDiscount: { value: 100, valueType: 'PERCENTAGE', title: 'Seeding Gift – 100% Off' },
          note: `Seeding for ${influencer?.handle ?? ''} (${influencer?.name ?? ''})`,
          tags: ['seeding'],
        },
      };
      const res   = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': session.accessToken },
        body: JSON.stringify({ query: mutation, variables }),
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
    console.error('Failed to create Shopify draft order:', err);
  }

  await prisma.seeding.create({
    data: {
      shop, influencerId, campaignId, totalCost, notes, status: 'Pending',
      shopifyDraftOrderId, shopifyOrderName, invoiceUrl,
      products: {
        create: productIds.map((id, i) => ({
          productId:   id,
          variantId:   variantIds[i] || null,
          productName: productNames[i],
          price:       productPrices[i],
          cost:        productCosts[i] ?? null,
          imageUrl:    productImages[i] || null,
          size:        productSizes[i] || null,
          category:    productCategories[i] || null,
        })),
      },
    },
  });

  return redirect(campaignId ? `/app/campaigns/${campaignId}` : '/app');
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function avatarBg(str) {
  const palette = ['#F87171','#FB923C','#FBBF24','#34D399','#60A5FA','#A78BFA','#F472B6','#2DD4BF'];
  let h = 0;
  for (const ch of (str || '')) h = ch.charCodeAt(0) + ((h << 5) - h);
  return palette[Math.abs(h) % palette.length];
}

function initials(name) {
  return (name || '?').split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function tierInfo(followers) {
  const f = followers || 0;
  if (f >= 500_000) return { emoji: '🏆', label: 'Celebrity', color: '#7C3AED', bg: '#EDE9FE' };
  if (f >= 50_000)  return { emoji: '⭐', label: 'Influencer', color: '#1D4ED8', bg: '#DBEAFE' };
  return { emoji: '🌱', label: 'Micro', color: '#15803D', bg: '#DCFCE7' };
}

function fmtF(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return Math.round(n / 1_000) + 'K';
  return String(n);
}

// ── Stepper ───────────────────────────────────────────────────────────────────
function Stepper({ step }) {
  const steps = ['Influencer', 'Products', 'Confirm'];
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '28px' }}>
      {steps.map((label, i) => {
        const n      = i + 1;
        const done   = step > n;
        const active = step === n;
        return (
          <div key={n} style={{ display: 'flex', alignItems: 'center', flex: i < steps.length - 1 ? 1 : 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexShrink: 0 }}>
              <div style={{
                width: '26px', height: '26px', borderRadius: '50%',
                backgroundColor: done || active ? C.accent : '#F3F4F6',
                color: done || active ? '#fff' : '#9CA3AF',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: done ? '12px' : '11px', fontWeight: '800',
                transition: 'all 0.2s ease',
              }}>
                {done ? '✓' : n}
              </div>
              <span style={{
                fontSize: '12px',
                fontWeight: active ? '700' : '500',
                color: active ? '#1A1A1A' : done ? C.accent : '#9CA3AF',
                transition: 'color 0.2s ease',
              }}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div style={{
                flex: 1,
                height: '1px',
                backgroundColor: done ? C.accent : '#E5E7EB',
                margin: '0 10px',
                transition: 'background-color 0.3s ease',
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function NewSeeding() {
  const { influencers, campaigns, recentlySeededMap, allSavedSizes } = useLoaderData();
  const { products = [], shop = '' } = useRouteLoaderData('routes/app') ?? {};
  const navigate = useNavigate();

  const [step, setStep]                             = useState(1);
  const [selectedInfluencer, setSelectedInfluencer] = useState(null);
  const [selectedCampaign, setSelectedCampaign]     = useState(null);
  const [selectedProducts, setSelectedProducts]     = useState([]);
  const [expandedProductId, setExpandedProductId]   = useState(null);
  const [activeCollection, setActiveCollection]     = useState('All');
  const [search, setSearch]                         = useState('');
  const [infSearch, setInfSearch]                   = useState('');
  const [infTier, setInfTier]                       = useState('all');
  const [infCountry, setInfCountry]                 = useState('');

  // Drag & drop state
  const [dragOver, setDragOver]           = useState(false);
  const [shakeId, setShakeId]             = useState(null);
  const [dragProductId, setDragProductId] = useState(null);

  const INF_TIERS = [
    { key: 'all',   label: 'All' },
    { key: 'micro', label: '🌱 Micro' },
    { key: 'mid',   label: '⭐ Mid' },
    { key: 'celeb', label: '🏆 Celebrity' },
  ];

  const allCountries = [...new Set(influencers.map(i => i.country).filter(Boolean))].sort();

  const recentlySeedMapForInfluencer = selectedInfluencer
    ? (recentlySeededMap[selectedInfluencer.id] ?? {})
    : {};

  const influencerSizeMap = selectedInfluencer?.id
    ? (allSavedSizes[selectedInfluencer.id] ?? {})
    : {};

  // Auto-apply saved sizes when influencer changes
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

  const filteredInfluencers = influencers.filter(inf => {
    const q = infSearch.toLowerCase();
    if (q && !inf.handle.toLowerCase().includes(q) && !inf.name.toLowerCase().includes(q)) return false;
    if (infCountry && inf.country !== infCountry) return false;
    const f = inf.followers || 0;
    if (infTier === 'micro' && f >= 50000)                return false;
    if (infTier === 'mid'   && (f < 50000 || f >= 500000)) return false;
    if (infTier === 'celeb' && f < 500000)                return false;
    return true;
  });

  const campaignProductIds = selectedCampaign
    ? new Set(selectedCampaign.products.map(cp => cp.productId))
    : null;
  const visibleProducts  = campaignProductIds
    ? products.filter(p => campaignProductIds.has(p.id))
    : products;
  const allCollections   = ['All', ...new Set(visibleProducts.flatMap(p => p.collections))];
  const filteredProducts = visibleProducts
    .filter(p => activeCollection === 'All' || p.collections.includes(activeCollection))
    .filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()));

  const selectVariant = (prod, variant) => {
    const category = guessProductCategory(prod.name, variant?.title);
    const extractedSize = extractSizeFromVariant(variant?.title);
    setSelectedProducts(prev => [
      ...prev.filter(p => p.id !== prod.id),
      { ...prod, selectedVariant: variant, category, size: extractedSize },
    ]);
    setExpandedProductId(null);
  };

  const updateProductSize = (prodId, newSize) => {
    setSelectedProducts(prev =>
      prev.map(p => (p.id === prodId ? { ...p, size: newSize, sizeUnavailable: false } : p))
    );
  };

  const removeProduct = (prodId) =>
    setSelectedProducts(prev => prev.filter(p => p.id !== prodId));

  const handleCampaignSelect = (c) => {
    setSelectedCampaign(c);
    setSelectedProducts([]);
    setActiveCollection('All');
    setSearch('');
  };

  // Drag & drop handlers
  const handleDragStart = (e, prod) => {
    setDragProductId(prod.id);
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', prod.id);
  };

  const handleDragEnd = () => setDragProductId(null);

  const handleBagDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  };

  const handleBagDragLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false);
  };

  const handleBagDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const pid  = e.dataTransfer.getData('text/plain');
    const prod = filteredProducts.find(p => p.id === pid)
              || products.find(p => p.id === pid);
    if (!prod || prod.stock <= 0) return;
    if (selectedProducts.find(p => p.id === prod.id)) {
      setShakeId(prod.id);
      setTimeout(() => setShakeId(null), 500);
      return;
    }
    if (recentlySeedMapForInfluencer[prod.id]) {
      setShakeId(prod.id);
      setTimeout(() => setShakeId(null), 500);
      return;
    }

    const category   = guessProductCategory(prod.name);
    const savedSize  = influencerSizeMap[category];

    let matchedVariant  = null;
    let sizeUnavailable = false;

    if (savedSize && prod.variants && prod.variants.length > 1) {
      const match = prod.variants.find(v => extractSizeFromVariant(v.title) === savedSize);
      if (match) {
        if (match.available !== false) matchedVariant = match;
        else sizeUnavailable = true;
      } else {
        sizeUnavailable = true;
      }
    }

    setSelectedProducts(prev => [
      ...prev,
      {
        ...prod,
        selectedVariant: matchedVariant,
        category,
        size:            matchedVariant ? extractSizeFromVariant(matchedVariant.title) : null,
        sizeUnavailable,
      },
    ]);
  };

  const totalRetail  = selectedProducts.reduce((s, p) => s + (p.selectedVariant?.price ?? p.price), 0);
  const totalCost    = selectedProducts.reduce((s, p) => s + (p.selectedVariant?.cost ?? p.cost ?? 0), 0);
  const missingSizes = getProductsWithoutSize(selectedProducts);

  return (
    <div>
      <style>{`
        @keyframes fadeIn  { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes shake   { 0%,100% { transform: translateX(0); } 20% { transform: translateX(-4px); } 40% { transform: translateX(4px); } 60% { transform: translateX(-3px); } 80% { transform: translateX(3px); } }
        @keyframes popIn   { 0% { transform: scale(0.7); opacity: 0; } 80% { transform: scale(1.06); } 100% { transform: scale(1); opacity: 1; } }
        .inf-card:hover    { background: #FAFAFA !important; }
        .inf-active:hover  { background: ${C.accentFaint} !important; }
        .prod-card         { transition: transform 0.12s ease, box-shadow 0.12s ease; }
        .prod-card:not([data-out]):hover { transform: scale(1.025); box-shadow: 0 4px 14px rgba(0,0,0,0.09); }
        .bag-item          { animation: fadeIn 0.18s ease; }
        .rm-btn:hover      { color: #EF4444 !important; }
      `}</style>

      {/* ── Page header ── */}
      <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#1A1A1A' }}>New Seeding</h2>
          <p style={{ margin: '3px 0 0', fontSize: '13px', color: '#9CA3AF' }}>Send products to an influencer</p>
        </div>

        {/* Campaign selector — compact pill row in header */}
        {campaigns.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '11px', fontWeight: '600', color: '#C4C4C4' }}>Campaign:</span>
            {campaigns.map(c => {
              const active = selectedCampaign?.id === c.id;
              return (
                <button key={c.id} type="button" onClick={() => handleCampaignSelect(active ? null : c)} style={{
                  padding: '4px 12px', fontSize: '12px', fontWeight: '600',
                  border: `1.5px solid ${active ? C.accent : '#E5E7EB'}`,
                  cursor: 'pointer', borderRadius: '20px',
                  backgroundColor: active ? C.accentFaint : 'transparent',
                  color: active ? C.accent : '#6B7280',
                  transition: 'all 0.15s ease',
                }}>
                  {active && <span style={{ marginRight: '3px' }}>✓</span>}{c.title}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <Form method="post">
        {/* Hidden inputs */}
        <input type="hidden" name="shop" value={shop} />
        {selectedInfluencer && <input type="hidden" name="influencerId" value={selectedInfluencer.id} />}
        {selectedCampaign   && <input type="hidden" name="campaignId"   value={selectedCampaign.id} />}
        {selectedProducts.map(p => (
          <span key={p.id}>
            <input type="hidden" name="productIds"          value={p.id} />
            <input type="hidden" name="variantIds"          value={p.selectedVariant?.id ?? p.variantId ?? ''} />
            <input type="hidden" name="productNames"        value={`${p.name}${p.selectedVariant && p.selectedVariant.title !== 'Default Title' ? ` – ${p.selectedVariant.title}` : ''}`} />
            <input type="hidden" name="productPrices"       value={p.selectedVariant?.price ?? p.price} />
            <input type="hidden" name="productCosts"        value={p.selectedVariant?.cost ?? p.cost ?? ''} />
            <input type="hidden" name="productImages"       value={p.image ?? ''} />
            <input type="hidden" name="productSizes"        value={p.size ?? ''} />
            <input type="hidden" name="productCategories"   value={p.category ?? ''} />
          </span>
        ))}

        <Stepper step={step} />

        {/* ══════════════════ STEP 1 — INFLUENCER ══════════════════ */}
        {step === 1 && (
          <div style={{ animation: 'fadeIn 0.25s ease' }}>

            {influencers.length === 0 ? (
              <div style={{ padding: '48px', textAlign: 'center', border: `2px dashed #E5E7EB`, color: '#9CA3AF', borderRadius: '12px' }}>
                <div style={{ fontSize: '32px', marginBottom: '10px' }}>👥</div>
                <p style={{ margin: '0 0 12px', fontSize: '14px', color: '#6B7280' }}>No influencers yet.</p>
                <a href="/app/influencers" style={{ color: C.accent, fontWeight: '700', textDecoration: 'none' }}>Add influencers first →</a>
              </div>
            ) : (
              <>
                {/* Search + country */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    placeholder="Search by name or @handle…"
                    value={infSearch}
                    onChange={e => setInfSearch(e.target.value)}
                    style={{ ...input.base, flex: '1', minWidth: '180px', fontSize: '13px' }}
                  />
                  {allCountries.length > 0 && (
                    <select value={infCountry} onChange={e => setInfCountry(e.target.value)}
                      style={{ ...input.base, fontSize: '13px', minWidth: '130px', width: 'auto' }}>
                      <option value="">All countries</option>
                      {allCountries.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  )}
                </div>

                {/* Tier filters */}
                <div style={{ display: 'flex', gap: '5px', marginBottom: '16px', flexWrap: 'wrap' }}>
                  {INF_TIERS.map(t => (
                    <button key={t.key} type="button" onClick={() => setInfTier(t.key)} style={{
                      padding: '4px 12px', borderRadius: '16px',
                      border: `1.5px solid ${infTier === t.key ? C.accent : '#E5E7EB'}`,
                      backgroundColor: infTier === t.key ? C.accentFaint : 'transparent',
                      color: infTier === t.key ? C.accent : '#6B7280',
                      fontSize: '12px', fontWeight: infTier === t.key ? '700' : '500',
                      cursor: 'pointer', transition: 'all 0.15s ease',
                    }}>{t.label}</button>
                  ))}
                </div>

                {/* Influencer grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))', gap: '8px', maxHeight: '480px', overflowY: 'auto', paddingRight: '2px' }}>
                  {filteredInfluencers.length === 0 ? (
                    <div style={{ gridColumn: '1/-1', padding: '32px', textAlign: 'center', color: '#9CA3AF', fontSize: '13px' }}>
                      No influencers match your search.
                    </div>
                  ) : filteredInfluencers.map(inf => {
                    const active = selectedInfluencer?.id === inf.id;
                    const tier   = tierInfo(inf.followers);
                    const bg     = avatarBg(inf.handle);
                    return (
                      <button
                        key={inf.id}
                        type="button"
                        className={active ? 'inf-card inf-active' : 'inf-card'}
                        onClick={() => setSelectedInfluencer(active ? null : inf)}
                        style={{
                          padding: '12px',
                          backgroundColor: active ? C.accentFaint : '#FFFFFF',
                          border: `${active ? '2px' : '1px'} solid ${active ? C.accent : '#F0F0F0'}`,
                          borderRadius: '10px', cursor: 'pointer', textAlign: 'left',
                          boxShadow: active ? `0 0 0 3px rgba(217,119,87,0.1)` : '0 1px 3px rgba(0,0,0,0.04)',
                          transition: 'all 0.15s ease',
                          position: 'relative',
                        }}
                      >
                        {active && (
                          <div style={{ position: 'absolute', top: '8px', right: '8px', width: '18px', height: '18px', borderRadius: '50%', backgroundColor: C.accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: '900', animation: 'popIn 0.2s ease' }}>✓</div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '8px' }}>
                          <div style={{ width: '34px', height: '34px', borderRadius: '50%', backgroundColor: bg, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: '800', flexShrink: 0 }}>
                            {initials(inf.name || inf.handle)}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: '13px', fontWeight: '700', color: '#1A1A1A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inf.handle}</div>
                            {inf.name && <div style={{ fontSize: '11px', color: '#9CA3AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inf.name}</div>}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '10px', fontWeight: '700', padding: '1px 6px', borderRadius: '5px', backgroundColor: tier.bg, color: tier.color }}>
                            {tier.emoji} {tier.label}
                          </span>
                          {inf.followers > 0 && <span style={{ fontSize: '10px', color: '#9CA3AF', fontWeight: '600' }}>{fmtF(inf.followers)}</span>}
                          {inf.country && <span style={{ fontSize: '10px', color: '#9CA3AF', marginLeft: 'auto' }}>{inf.country}</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {/* Footer */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '24px', paddingTop: '16px', borderTop: '1px solid #F3F4F6' }}>
              <button type="button" onClick={() => navigate('/app')} style={{ ...btn.secondary }}>Cancel</button>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {selectedInfluencer && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '22px', height: '22px', borderRadius: '50%', backgroundColor: avatarBg(selectedInfluencer.handle), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', fontWeight: '800' }}>
                      {initials(selectedInfluencer.name || selectedInfluencer.handle)}
                    </div>
                    <span style={{ fontSize: '13px', fontWeight: '700', color: '#1A1A1A' }}>{selectedInfluencer.handle}</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  disabled={!selectedInfluencer}
                  style={{ ...btn.primary, opacity: selectedInfluencer ? 1 : 0.35, cursor: selectedInfluencer ? 'pointer' : 'not-allowed' }}
                >
                  Products →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════ STEP 2 — PRODUCTS ══════════════════ */}
        {step === 2 && (
          <div style={{ animation: 'fadeIn 0.25s ease' }}>
            <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>

              {/* Left: Product browser */}
              <div style={{ flex: '1 1 0', minWidth: 0 }}>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', alignItems: 'center' }}>
                  <input
                    type="text"
                    placeholder="Search products…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{ ...input.base, flex: 1, fontSize: '13px' }}
                  />
                  {selectedCampaign && (
                    <span style={{ fontSize: '12px', fontWeight: '600', color: C.accent, backgroundColor: C.accentFaint, padding: '5px 12px', borderRadius: '20px', border: `1px solid ${C.accent}`, whiteSpace: 'nowrap' }}>
                      📁 {selectedCampaign.title}
                    </span>
                  )}
                </div>

                {allCollections.length > 1 && (
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '12px' }}>
                    {allCollections.map(col => (
                      <button key={col} type="button" onClick={() => setActiveCollection(col)} style={{
                        padding: '3px 11px', fontSize: '11px', fontWeight: '600',
                        border: `1.5px solid ${activeCollection === col ? C.accent : '#E5E7EB'}`,
                        cursor: 'pointer', borderRadius: '20px',
                        backgroundColor: activeCollection === col ? C.accentFaint : 'transparent',
                        color: activeCollection === col ? C.accent : '#6B7280',
                        transition: 'all 0.15s ease',
                      }}>{col}</button>
                    ))}
                  </div>
                )}

                {/* Product grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(108px, 1fr))', gap: '7px' }}>
                  {filteredProducts.map(prod => {
                    const selected     = selectedProducts.find(p => p.id === prod.id);
                    const outOfStock   = prod.stock <= 0;
                    const isExpanded   = expandedProductId === prod.id;
                    const isSingle     = prod.variants.length === 1 && prod.variants[0].title === 'Default Title';
                    const isDragging   = dragProductId === prod.id;
                    const isShaking    = shakeId === prod.id;
                    const recentlySent = !!recentlySeedMapForInfluencer[prod.id];

                    return (
                      <div key={prod.id} style={{ display: 'flex', flexDirection: 'column' }}>
                        <div
                          draggable={!outOfStock && !recentlySent}
                          onDragStart={e => handleDragStart(e, prod)}
                          onDragEnd={handleDragEnd}
                          className="prod-card"
                          data-out={outOfStock ? 'true' : undefined}
                          onClick={() => {
                            if (outOfStock) return;
                            if (recentlySent && !selected) { setShakeId(prod.id); setTimeout(() => setShakeId(null), 500); return; }
                            if (selected) { removeProduct(prod.id); setExpandedProductId(null); return; }
                            if (isSingle)  { selectVariant(prod, prod.variants[0]); return; }
                            setExpandedProductId(isExpanded ? null : prod.id);
                          }}
                          style={{
                            backgroundColor: outOfStock ? '#F9FAFB' : selected ? C.accentFaint : recentlySent ? '#FFFBEB' : '#FFFFFF',
                            border: `${selected ? '2px' : '1px'} solid ${outOfStock ? '#F0F0F0' : selected ? C.accent : recentlySent ? '#FCD34D' : isExpanded ? C.accent : '#F0F0F0'}`,
                            cursor: outOfStock ? 'not-allowed' : (recentlySent && !selected) ? 'not-allowed' : 'grab',
                            borderRadius: isExpanded ? '8px 8px 0 0' : '8px',
                            overflow: 'hidden',
                            position: 'relative',
                            opacity: outOfStock ? 0.4 : isDragging ? 0.35 : 1,
                            animation: isShaking ? 'shake 0.4s ease' : 'none',
                            userSelect: 'none',
                          }}
                        >
                          {prod.image ? (
                            <div style={{ width: '100%', aspectRatio: '1/1', overflow: 'hidden', backgroundColor: '#F7F7F7' }}>
                              <img src={prod.image} alt={prod.name} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
                            </div>
                          ) : (
                            <div style={{ width: '100%', aspectRatio: '1/1', backgroundColor: '#F7F7F7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '26px' }}>📦</div>
                          )}
                          {selected && (
                            <div style={{ position: 'absolute', top: '4px', right: '4px', width: '18px', height: '18px', borderRadius: '50%', backgroundColor: C.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: '900', color: '#fff', animation: 'popIn 0.2s ease' }}>✓</div>
                          )}
                          {outOfStock && (
                            <div style={{ position: 'absolute', top: '4px', left: '4px', backgroundColor: '#DC2626', color: '#fff', fontSize: '8px', fontWeight: '800', padding: '2px 4px', borderRadius: '3px', textTransform: 'uppercase' }}>No stock</div>
                          )}
                          {recentlySent && !outOfStock && (
                            <div style={{ position: 'absolute', top: '4px', left: '4px', backgroundColor: '#D97706', color: '#fff', fontSize: '8px', fontWeight: '800', padding: '2px 4px', borderRadius: '3px', textTransform: 'uppercase' }}>Sent</div>
                          )}
                          <div style={{ padding: '5px 7px', backgroundColor: selected ? C.accentFaint : '#FFFFFF' }}>
                            <div style={{ fontWeight: '600', fontSize: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: selected ? C.accent : '#1A1A1A' }}>{prod.name}</div>
                            <div style={{ fontSize: '10px', color: '#9CA3AF', marginTop: '1px' }}>€{prod.price.toFixed(2)}</div>
                          </div>
                        </div>

                        {/* Variant picker */}
                        {isExpanded && !isSingle && (
                          <div style={{ border: `2px solid ${C.accent}`, borderTop: 'none', borderRadius: '0 0 8px 8px', padding: '7px', backgroundColor: '#fff', display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                            <div style={{ width: '100%', fontSize: '9px', fontWeight: '700', color: '#9CA3AF', textTransform: 'uppercase', marginBottom: '3px' }}>Pick a size</div>
                            {prod.variants.map(v => (
                              <button key={v.id} type="button" onClick={() => v.available && selectVariant(prod, v)} style={{
                                padding: '3px 7px', fontSize: '11px', fontWeight: '700',
                                border: `1.5px solid ${v.available ? '#E3E3E3' : '#F3F4F6'}`,
                                borderRadius: '4px', cursor: v.available ? 'pointer' : 'not-allowed',
                                backgroundColor: v.available ? '#fff' : '#F9FAFB',
                                color: v.available ? '#1A1A1A' : '#D1D5DB',
                                textDecoration: !v.available ? 'line-through' : 'none',
                              }}>{v.title}</button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Right: Selected items panel */}
              <div
                onDragOver={handleBagDragOver}
                onDragLeave={handleBagDragLeave}
                onDrop={handleBagDrop}
                style={{
                  width: '232px',
                  flexShrink: 0,
                  position: 'sticky',
                  top: '16px',
                  borderRadius: '12px',
                  border: `1.5px solid ${dragOver ? C.accent : '#E8E8E8'}`,
                  backgroundColor: dragOver ? C.accentFaint : '#FAFAFA',
                  overflow: 'hidden',
                  transition: 'border-color 0.15s, background-color 0.15s',
                  boxShadow: dragOver ? `0 0 0 3px rgba(217,119,87,0.1)` : 'none',
                }}
              >
                {/* Panel header */}
                <div style={{ padding: '11px 13px', borderBottom: `1px solid ${selectedProducts.length > 0 ? '#EFEFEF' : 'transparent'}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12px', fontWeight: '700', color: '#1A1A1A' }}>Selected items</span>
                  {selectedProducts.length > 0 && (
                    <span style={{ fontSize: '11px', fontWeight: '700', backgroundColor: C.accent, color: '#fff', borderRadius: '10px', padding: '1px 8px', animation: 'popIn 0.2s ease' }}>
                      {selectedProducts.length}
                    </span>
                  )}
                </div>

                {/* Items / empty state */}
                <div style={{
                  minHeight: selectedProducts.length === 0 ? '150px' : undefined,
                  maxHeight: '360px',
                  overflowY: 'auto',
                  padding: selectedProducts.length === 0 ? '0' : '8px',
                }}>
                  {selectedProducts.length === 0 ? (
                    <div style={{ height: '150px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', color: dragOver ? C.accent : '#C8C8C8', transition: 'color 0.15s' }}>
                      <div style={{ fontSize: '26px', transform: dragOver ? 'scale(1.2)' : 'scale(1)', transition: 'transform 0.2s ease' }}>📦</div>
                      <span style={{ fontSize: '12px', fontWeight: dragOver ? '600' : '400', textAlign: 'center' }}>
                        {dragOver ? 'Drop here' : 'Drag or click products'}
                      </span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                      {selectedProducts.map(p => {
                        const sizeWarn = !p.size;
                        return (
                          <div key={p.id} className="bag-item" style={{ backgroundColor: sizeWarn ? '#FEF3F2' : '#fff', border: `1px solid ${sizeWarn ? '#FCA5A5' : '#EFEFEF'}`, borderRadius: '8px', padding: '7px 7px 5px' }}>
                            <div style={{ display: 'flex', gap: '7px', alignItems: 'flex-start' }}>
                              {p.image
                                ? <img src={p.image} alt={p.name} style={{ width: '28px', height: '28px', objectFit: 'contain', borderRadius: '4px', backgroundColor: '#F7F7F7', flexShrink: 0 }} />
                                : <div style={{ width: '28px', height: '28px', backgroundColor: '#F3F4F6', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', flexShrink: 0 }}>📦</div>
                              }
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: '11px', fontWeight: '700', color: '#1A1A1A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                                <div style={{ fontSize: '10px', color: '#9CA3AF' }}>
                                  €{(p.selectedVariant?.price ?? p.price).toFixed(2)}
                                  {p.selectedVariant && p.selectedVariant.title !== 'Default Title' && (
                                    <span style={{ color: C.accent, fontWeight: '600', marginLeft: '3px' }}>· {p.selectedVariant.title}</span>
                                  )}
                                </div>
                              </div>
                              <button type="button" className="rm-btn" onClick={() => removeProduct(p.id)}
                                style={{ background: 'none', border: 'none', color: '#D1D5DB', cursor: 'pointer', fontSize: '16px', lineHeight: 1, padding: '1px', flexShrink: 0, transition: 'color 0.12s' }}>×</button>
                            </div>

                            {/* Size selector */}
                            {p.variants && p.variants.length > 1 && (
                              <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', marginTop: '5px' }}>
                                {p.variants.map(v => {
                                  const vSize = extractSizeFromVariant(v.title);
                                  const isSel = p.size === vSize;
                                  if (!vSize) return null;
                                  return (
                                    <button key={v.id} type="button" onClick={() => updateProductSize(p.id, vSize)} style={{
                                      padding: '2px 6px', fontSize: '9px', fontWeight: isSel ? '700' : '600',
                                      border: `1.5px solid ${isSel ? C.accent : '#E3E3E3'}`,
                                      backgroundColor: isSel ? C.accentFaint : '#fff',
                                      color: isSel ? C.accent : '#6B7280',
                                      borderRadius: '4px',
                                      cursor: v.available ? 'pointer' : 'not-allowed',
                                      opacity: v.available ? 1 : 0.5,
                                      transition: 'all 0.12s ease',
                                    }}>{vSize}</button>
                                  );
                                })}
                              </div>
                            )}
                            {p.sizeUnavailable && (
                              <div style={{ fontSize: '9px', color: '#DC2626', fontWeight: '600', marginTop: '3px' }}>⚠️ Saved size out of stock</div>
                            )}
                            {!p.sizeUnavailable && sizeWarn && (
                              <div style={{ fontSize: '9px', color: '#DC2626', fontWeight: '600', marginTop: '3px' }}>⚠️ Size required</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Totals */}
                {selectedProducts.length > 0 && (
                  <div style={{ padding: '9px 13px', borderTop: '1px solid #EFEFEF', backgroundColor: '#fff' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#6B7280', marginBottom: '2px' }}>
                      <span>Retail value</span>
                      <strong style={{ color: '#1A1A1A' }}>€{totalRetail.toFixed(2)}</strong>
                    </div>
                    {totalCost > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#6B7280' }}>
                        <span>Your cost</span>
                        <strong style={{ color: '#1A1A1A' }}>€{totalCost.toFixed(2)}</strong>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Step 2 footer */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px', paddingTop: '16px', borderTop: '1px solid #F3F4F6', gap: '10px', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setStep(1)} style={{ ...btn.secondary }}>← Back</button>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {missingSizes.length > 0 && (
                  <span style={{ fontSize: '12px', color: '#DC2626', fontWeight: '600' }}>
                    ⚠️ {missingSizes.length} item{missingSizes.length !== 1 ? 's' : ''} need{missingSizes.length === 1 ? 's' : ''} a size
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  disabled={selectedProducts.length === 0 || missingSizes.length > 0}
                  style={{ ...btn.primary, opacity: selectedProducts.length > 0 && missingSizes.length === 0 ? 1 : 0.35, cursor: selectedProducts.length > 0 && missingSizes.length === 0 ? 'pointer' : 'not-allowed' }}
                >
                  Review →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════ STEP 3 — CONFIRM ══════════════════ */}
        {step === 3 && (
          <div style={{ animation: 'fadeIn 0.25s ease', maxWidth: '560px' }}>

            {/* Summary card */}
            <div style={{ backgroundColor: '#fff', border: '1px solid #F0F0F0', borderRadius: '14px', padding: '20px', marginBottom: '14px', boxShadow: '0 1px 6px rgba(0,0,0,0.04)' }}>
              {/* Influencer */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', paddingBottom: '14px', borderBottom: '1px solid #F5F5F5' }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: avatarBg(selectedInfluencer?.handle || ''), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', fontWeight: '800', flexShrink: 0 }}>
                  {initials(selectedInfluencer?.name || selectedInfluencer?.handle || '')}
                </div>
                <div>
                  <div style={{ fontSize: '15px', fontWeight: '800', color: '#1A1A1A' }}>{selectedInfluencer?.handle}</div>
                  {selectedInfluencer?.name && <div style={{ fontSize: '12px', color: '#9CA3AF' }}>{selectedInfluencer.name}</div>}
                </div>
                {selectedCampaign && (
                  <div style={{ marginLeft: 'auto', padding: '4px 11px', backgroundColor: C.accentFaint, color: C.accent, fontSize: '12px', fontWeight: '700', borderRadius: '20px' }}>
                    📁 {selectedCampaign.title}
                  </div>
                )}
              </div>

              {/* Products */}
              <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#B0B0B0', marginBottom: '8px' }}>
                Products ({selectedProducts.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '16px' }}>
                {selectedProducts.map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '4px 9px 4px 5px', border: '1px solid #F0F0F0', backgroundColor: '#FAFAFA', borderRadius: '7px' }}>
                    {p.image && <img src={p.image} alt={p.name} style={{ width: '20px', height: '20px', objectFit: 'contain', borderRadius: '3px' }} />}
                    <span style={{ fontSize: '12px', fontWeight: '600', color: '#1A1A1A' }}>{p.name}</span>
                    {p.selectedVariant && p.selectedVariant.title !== 'Default Title' && (
                      <span style={{ fontSize: '11px', color: C.accent, fontWeight: '700' }}>{p.selectedVariant.title}</span>
                    )}
                    {p.size && (
                      <span style={{ fontSize: '10px', fontWeight: '700', backgroundColor: '#EDE9FE', color: '#7C3AED', padding: '1px 5px', borderRadius: '4px' }}>{p.size}</span>
                    )}
                  </div>
                ))}
              </div>

              {/* Totals */}
              <div style={{ display: 'flex', gap: '24px', paddingTop: '12px', borderTop: '1px solid #F5F5F5' }}>
                <div>
                  <div style={{ fontSize: '10px', color: '#B0B0B0', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>Retail Value</div>
                  <div style={{ fontSize: '22px', fontWeight: '900', color: C.accent }}>€{totalRetail.toFixed(2)}</div>
                </div>
                {totalCost > 0 && (
                  <div>
                    <div style={{ fontSize: '10px', color: '#B0B0B0', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>Your Cost</div>
                    <div style={{ fontSize: '22px', fontWeight: '900', color: '#1A1A1A' }}>€{totalCost.toFixed(2)}</div>
                  </div>
                )}
              </div>
            </div>

            {/* What happens next */}
            <div style={{ backgroundColor: '#FFFBF9', border: `1px solid rgba(217,119,87,0.18)`, borderRadius: '10px', padding: '13px 15px', marginBottom: '14px' }}>
              <div style={{ fontSize: '10px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.7px', color: C.accent, marginBottom: '9px' }}>What happens next</div>
              {[
                ['🛒', 'A Shopify draft order is created with 100% discount'],
                ['🔗', 'You get a checkout link to share with the influencer'],
                ['📦', 'They fill their own address and check out for free'],
                ['✅', 'Your fulfillment center receives the order automatically'],
              ].map(([icon, text]) => (
                <div key={text} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '5px' }}>
                  <span style={{ fontSize: '13px', flexShrink: 0, lineHeight: '18px' }}>{icon}</span>
                  <span style={{ fontSize: '12px', color: '#6B7280', lineHeight: '18px' }}>{text}</span>
                </div>
              ))}
            </div>

            {/* Notes */}
            <label style={{ display: 'block', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#B0B0B0', marginBottom: '5px' }}>
              Notes <span style={{ fontWeight: '400', textTransform: 'none', color: '#D0D0D0', marginLeft: '3px' }}>— optional</span>
            </label>
            <textarea
              name="notes"
              rows={2}
              placeholder="Campaign notes, content direction, what to post…"
              style={{ display: 'block', width: '100%', padding: '10px 12px', border: '1px solid #E5E7EB', backgroundColor: '#FAFAFA', color: '#1A1A1A', fontSize: '13px', borderRadius: '8px', fontFamily: 'system-ui', resize: 'vertical', boxSizing: 'border-box', marginBottom: '18px', outline: 'none' }}
            />

            {/* Actions */}
            <div style={{ display: 'flex', gap: '10px', alignItems: 'stretch' }}>
              <button type="button" onClick={() => setStep(2)} style={{ ...btn.secondary, flexShrink: 0 }}>← Back</button>
              <button
                type="submit"
                style={{
                  flex: 1,
                  padding: '14px 20px',
                  borderRadius: '10px',
                  border: 'none',
                  background: `linear-gradient(135deg, ${C.accent} 0%, #C86845 100%)`,
                  color: '#fff',
                  fontSize: '15px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  boxShadow: '0 4px 18px rgba(217,119,87,0.35)',
                  letterSpacing: '-0.1px',
                }}
              >
                🚀 Create Seeding + Generate Link
              </button>
            </div>
          </div>
        )}
      </Form>
    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
