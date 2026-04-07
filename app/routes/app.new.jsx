import { useState, useEffect } from 'react';
import { useLoaderData, useRouteLoaderData, useNavigate, Form, redirect, useRouteError } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import prisma from '../db.server';
import { C, btn, input, fmtNum } from '../theme';
import { guessProductCategory, extractSizeFromVariant, getProductsWithoutSize } from '../utils/size-helpers';

// ── Loader ───────────────────────────────────────────────────────────────────
export async function loader() {
  const influencers = await prisma.influencer.findMany({ orderBy: { name: 'asc' } });
  const campaigns   = await prisma.campaign.findMany({
    orderBy: { createdAt: 'desc' },
    include: { products: true },
  });
  return { influencers, campaigns };
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
  const steps = [
    { n: 1, label: 'Influencer', icon: '👤' },
    { n: 2, label: 'Products',   icon: '📦' },
    { n: 3, label: 'Review',     icon: '✨' },
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '40px' }}>
      {steps.map(({ n, label, icon }, i) => {
        const done   = step > n;
        const active = step === n;
        return (
          <div key={n} style={{ display: 'flex', alignItems: 'flex-start', flex: i < steps.length - 1 ? 1 : 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
              <div style={{
                width: '42px', height: '42px', borderRadius: '50%',
                backgroundColor: done ? C.accent : active ? C.accent : '#F3F4F6',
                color: done || active ? '#fff' : '#9CA3AF',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: done ? '18px' : '16px',
                fontWeight: '900',
                border: `3px solid ${done || active ? C.accent : '#E5E7EB'}`,
                boxShadow: active ? `0 0 0 6px rgba(217, 119, 87, 0.12)` : 'none',
                transition: 'all 0.3s ease',
                flexShrink: 0,
              }}>
                {done ? '✓' : icon}
              </div>
              <span style={{
                fontSize: '11px',
                fontWeight: active ? '700' : '500',
                color: active ? C.text : done ? C.accent : '#9CA3AF',
                whiteSpace: 'nowrap',
              }}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div style={{
                flex: 1,
                height: '3px',
                backgroundColor: done ? C.accent : '#E5E7EB',
                margin: '19px 6px 0',
                borderRadius: '2px',
                transition: 'background-color 0.4s ease',
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
  const { influencers, campaigns } = useLoaderData();
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
    { key: 'mid',   label: '⭐ Influencer' },
    { key: 'celeb', label: '🏆 Celebrity' },
  ];

  const allCountries = [...new Set(influencers.map(i => i.country).filter(Boolean))].sort();

  // Load influencer saved sizes when influencer is selected
  const [influencerSizeMap, setInfluencerSizeMap] = useState({});

  useEffect(() => {
    if (!selectedInfluencer?.id) {
      setInfluencerSizeMap({});
      return;
    }

    fetch(`/api/influencer-sizes?influencerId=${selectedInfluencer.id}`)
      .then(res => res.json())
      .then(data => {
        if (data.sizeMap) {
          setInfluencerSizeMap(data.sizeMap);
          // Auto-apply sizes to existing products
          setSelectedProducts(prev =>
            prev.map(p => {
              if (p.size) return p; // Don't override if already set
              const savedSize = data.sizeMap[p.category];
              return savedSize ? { ...p, size: savedSize } : p;
            })
          );
        }
      })
      .catch(err => console.error('Failed to load influencer sizes:', err));
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
      prev.map(p => (p.id === prodId ? { ...p, size: newSize } : p))
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
    // Add product WITHOUT auto-assigning a size
    const category = guessProductCategory(prod.name);
    setSelectedProducts(prev => [
      ...prev,
      { ...prod, selectedVariant: null, category, size: null },
    ]);
  };

  const totalRetail = selectedProducts.reduce((s, p) => s + (p.selectedVariant?.price ?? p.price), 0);
  const totalCost   = selectedProducts.reduce((s, p) => s + (p.selectedVariant?.cost ?? p.cost ?? 0), 0);

  return (
    <div>
      {/* Animations */}
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20%       { transform: translateX(-5px); }
          40%       { transform: translateX(5px); }
          60%       { transform: translateX(-4px); }
          80%       { transform: translateX(4px); }
        }
        @keyframes popIn {
          0%   { transform: scale(0.7); opacity: 0; }
          70%  { transform: scale(1.08); }
          100% { transform: scale(1);   opacity: 1; }
        }
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(12px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        .inf-card { transition: all 0.18s ease !important; }
        .inf-card:hover { transform: translateY(-2px) !important; box-shadow: 0 6px 20px rgba(0,0,0,0.09) !important; }
        .prod-card { transition: all 0.15s ease !important; }
        .prod-card:not([data-out]):hover { transform: scale(1.03) !important; }
        .bag-item  { animation: slideIn 0.2s ease; }
        .remove-btn:hover { color: #EF4444 !important; }
      `}</style>

      <Form method="post">
        {/* Page header */}
        <div style={{ marginBottom: '32px' }}>
          <h2 style={{ margin: '0 0 4px', color: '#1A1A1A', fontSize: '22px', fontWeight: '800' }}>New Seeding</h2>
          <p style={{ margin: 0, fontSize: '13px', color: '#9CA3AF' }}>
            Send products to an influencer and generate a free checkout link.
          </p>
        </div>

        <Stepper step={step} />

        {/* Hidden inputs for form submission */}
        <input type="hidden" name="shop" value={shop} />
        {selectedInfluencer && <input type="hidden" name="influencerId" value={selectedInfluencer.id} />}
        {selectedCampaign   && <input type="hidden" name="campaignId"   value={selectedCampaign.id} />}
        {selectedProducts.map(p => (
          <span key={p.id}>
            <input type="hidden" name="productIds"    value={p.id} />
            <input type="hidden" name="variantIds"    value={p.selectedVariant?.id ?? p.variantId ?? ''} />
            <input type="hidden" name="productNames"  value={`${p.name}${p.selectedVariant && p.selectedVariant.title !== 'Default Title' ? ` – ${p.selectedVariant.title}` : ''}`} />
            <input type="hidden" name="productPrices" value={p.selectedVariant?.price ?? p.price} />
            <input type="hidden" name="productCosts"  value={p.selectedVariant?.cost ?? p.cost ?? ''} />
            <input type="hidden" name="productImages" value={p.image ?? ''} />
            <input type="hidden" name="productSizes"  value={p.size ?? ''} />
            <input type="hidden" name="productCategories" value={p.category ?? ''} />
          </span>
        ))}

        {/* ══════════════════ STEP 1 — INFLUENCER ══════════════════ */}
        {step === 1 && (
          <div style={{ animation: 'fadeInUp 0.3s ease' }}>

            {/* Campaign selector */}
            {campaigns.length > 0 && (
              <div style={{ marginBottom: '32px' }}>
                <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.7px', color: '#6B7280', marginBottom: '10px' }}>
                  📁 Campaign <span style={{ fontWeight: '400', textTransform: 'none', color: '#9CA3AF', marginLeft: '4px' }}>— optional</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {campaigns.map(c => {
                    const active = selectedCampaign?.id === c.id;
                    return (
                      <button key={c.id} type="button" onClick={() => handleCampaignSelect(active ? null : c)} style={{
                        padding: '7px 16px', fontSize: '13px', fontWeight: '600',
                        border: `1.5px solid ${active ? C.accent : '#E3E3E3'}`,
                        cursor: 'pointer', borderRadius: '20px',
                        backgroundColor: active ? C.accentFaint : 'transparent',
                        color: active ? C.accent : '#6B7280',
                        transition: 'all 0.15s ease',
                      }}>
                        {active ? '✓ ' : ''}{c.title}
                        {c.budget != null && <span style={{ fontWeight: '400', opacity: 0.6, marginLeft: '6px', fontSize: '11px' }}>€{fmtNum(c.budget)}</span>}
                      </button>
                    );
                  })}
                </div>
                {selectedCampaign && (
                  <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#9CA3AF' }}>
                    Products will be filtered to this campaign's {selectedCampaign.products.length} item{selectedCampaign.products.length !== 1 ? 's' : ''}.
                  </p>
                )}
              </div>
            )}

            <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.7px', color: '#6B7280', marginBottom: '14px' }}>
              👤 Select Influencer
            </div>

            {influencers.length === 0 ? (
              <div style={{ padding: '48px', textAlign: 'center', border: `2px dashed #E3E3E3`, color: '#9CA3AF', borderRadius: '12px' }}>
                <div style={{ fontSize: '36px', marginBottom: '12px' }}>👥</div>
                <p style={{ margin: '0 0 12px', fontSize: '15px', color: '#6B7280' }}>No influencers yet.</p>
                <a href="/app/influencers" style={{ color: C.accent, fontWeight: '700', textDecoration: 'none' }}>Add influencers first →</a>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
                  <input type="text" placeholder="🔍  Search by name or @handle…" value={infSearch} onChange={e => setInfSearch(e.target.value)}
                    style={{ ...input.base, flex: '1', minWidth: '200px', fontSize: '13px' }} />
                  <select value={infCountry} onChange={e => setInfCountry(e.target.value)}
                    style={{ ...input.base, fontSize: '13px', minWidth: '140px', width: 'auto' }}>
                    <option value="">🌍 All countries</option>
                    {allCountries.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', flexWrap: 'wrap' }}>
                  {INF_TIERS.map(t => (
                    <button key={t.key} type="button" onClick={() => setInfTier(t.key)} style={{
                      padding: '5px 14px', borderRadius: '16px',
                      border: `1.5px solid ${infTier === t.key ? C.accent : '#E3E3E3'}`,
                      backgroundColor: infTier === t.key ? C.accentFaint : 'transparent',
                      color: infTier === t.key ? C.accent : '#6B7280',
                      fontSize: '12px', fontWeight: infTier === t.key ? '700' : '500',
                      cursor: 'pointer', transition: 'all 0.15s ease',
                    }}>{t.label}</button>
                  ))}
                </div>

                {/* Influencer grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '10px', maxHeight: '480px', overflowY: 'auto', paddingRight: '4px' }}>
                  {filteredInfluencers.length === 0 ? (
                    <div style={{ gridColumn: '1/-1', padding: '32px', textAlign: 'center', color: '#9CA3AF', fontSize: '13px' }}>
                      No influencers match your search.
                    </div>
                  ) : filteredInfluencers.map(inf => {
                    const active = selectedInfluencer?.id === inf.id;
                    const tier   = tierInfo(inf.followers);
                    const bg     = avatarBg(inf.handle);
                    return (
                      <button key={inf.id} type="button" className="inf-card" onClick={() => setSelectedInfluencer(active ? null : inf)} style={{
                        padding: '16px',
                        backgroundColor: active ? C.accentFaint : '#FFFFFF',
                        border: `2px solid ${active ? C.accent : '#E3E3E3'}`,
                        borderRadius: '12px', cursor: 'pointer', textAlign: 'left',
                        boxShadow: active ? `0 0 0 3px rgba(217,119,87,0.12)` : '0 1px 4px rgba(0,0,0,0.04)',
                        position: 'relative',
                      }}>
                        {active && (
                          <div style={{ position: 'absolute', top: '10px', right: '10px', width: '20px', height: '20px', borderRadius: '50%', backgroundColor: C.accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '900', animation: 'popIn 0.2s ease' }}>✓</div>
                        )}
                        <div style={{ width: '44px', height: '44px', borderRadius: '50%', backgroundColor: bg, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', fontWeight: '800', marginBottom: '10px', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
                          {initials(inf.name || inf.handle)}
                        </div>
                        <div style={{ fontSize: '14px', fontWeight: '800', color: '#1A1A1A', marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {inf.handle}
                        </div>
                        {inf.name && (
                          <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inf.name}</div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '10px', fontWeight: '700', padding: '2px 7px', borderRadius: '8px', backgroundColor: tier.bg, color: tier.color }}>
                            {tier.emoji} {tier.label}
                          </span>
                          {inf.followers > 0 && <span style={{ fontSize: '11px', color: '#9CA3AF', fontWeight: '600' }}>{fmtF(inf.followers)}</span>}
                          {inf.country && <span style={{ fontSize: '11px', color: '#9CA3AF', marginLeft: 'auto' }}>{inf.country}</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '28px', paddingTop: '20px', borderTop: '1px solid #E3E3E3' }}>
              <button type="button" onClick={() => navigate('/app')} style={{ ...btn.secondary }}>Cancel</button>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {selectedInfluencer && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#6B7280' }}>
                    <div style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: avatarBg(selectedInfluencer.handle), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '800' }}>
                      {initials(selectedInfluencer.name || selectedInfluencer.handle)}
                    </div>
                    <strong style={{ color: '#1A1A1A' }}>{selectedInfluencer.handle}</strong>
                  </div>
                )}
                <button type="button" onClick={() => setStep(2)} disabled={!selectedInfluencer}
                  style={{ ...btn.primary, opacity: selectedInfluencer ? 1 : 0.35, cursor: selectedInfluencer ? 'pointer' : 'not-allowed', fontSize: '14px', padding: '10px 24px' }}>
                  Next: Products →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════ STEP 2 — PRODUCTS ══════════════════ */}
        {step === 2 && (
          <>
            <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', animation: 'fadeInUp 0.3s ease' }}>

              {/* Left: Product browser */}
              <div style={{ flex: '1 1 0', minWidth: 0 }}>
                {selectedCampaign && (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '5px 14px', backgroundColor: C.accentFaint, color: C.accent, fontSize: '12px', fontWeight: '700', marginBottom: '12px', borderRadius: '20px', border: `1px solid ${C.accent}` }}>
                    📁 {selectedCampaign.title} <span style={{ fontWeight: '400', opacity: 0.7 }}>· {selectedCampaign.products.length} products</span>
                  </div>
                )}

                <input type="text" placeholder="🔍  Search products…" value={search} onChange={e => setSearch(e.target.value)}
                  style={{ ...input.base, marginBottom: '10px' }} />

                {allCollections.length > 1 && (
                  <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginBottom: '14px' }}>
                    {allCollections.map(col => (
                      <button key={col} type="button" onClick={() => setActiveCollection(col)} style={{
                        padding: '4px 12px', fontSize: '11px', fontWeight: '600',
                        border: `1.5px solid ${activeCollection === col ? C.accent : '#E3E3E3'}`,
                        cursor: 'pointer', borderRadius: '20px',
                        backgroundColor: activeCollection === col ? C.accentFaint : 'transparent',
                        color: activeCollection === col ? C.accent : '#6B7280',
                        transition: 'all 0.15s ease',
                      }}>{col}</button>
                    ))}
                  </div>
                )}

                {/* Drag hint */}
                <p style={{ fontSize: '12px', color: '#9CA3AF', margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <span>⠿</span> Drag to bag or click to add
                </p>

                {/* Product grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '8px' }}>
                  {filteredProducts.map(prod => {
                    const selected   = selectedProducts.find(p => p.id === prod.id);
                    const outOfStock = prod.stock <= 0;
                    const isExpanded = expandedProductId === prod.id;
                    const isSingle   = prod.variants.length === 1 && prod.variants[0].title === 'Default Title';
                    const isDragging = dragProductId === prod.id;
                    const isShaking  = shakeId === prod.id;

                    return (
                      <div key={prod.id} style={{ display: 'flex', flexDirection: 'column' }}>
                        <div
                          draggable={!outOfStock}
                          onDragStart={e => handleDragStart(e, prod)}
                          onDragEnd={handleDragEnd}
                          className="prod-card"
                          data-out={outOfStock ? 'true' : undefined}
                          onClick={() => {
                            if (outOfStock) return;
                            if (selected) { removeProduct(prod.id); setExpandedProductId(null); return; }
                            if (isSingle)  { selectVariant(prod, prod.variants[0]); return; }
                            setExpandedProductId(isExpanded ? null : prod.id);
                          }}
                          style={{
                            backgroundColor: outOfStock ? '#F9FAFB' : selected ? C.accentFaint : isExpanded ? '#F9FAFB' : '#FFFFFF',
                            border: `2px solid ${outOfStock ? '#E5E7EB' : selected ? C.accent : isExpanded ? C.accent : '#E3E3E3'}`,
                            cursor: outOfStock ? 'not-allowed' : 'grab',
                            borderRadius: isExpanded ? '8px 8px 0 0' : '8px',
                            overflow: 'hidden',
                            position: 'relative',
                            opacity: outOfStock ? 0.45 : isDragging ? 0.4 : 1,
                            animation: isShaking ? 'shake 0.4s ease' : 'none',
                            userSelect: 'none',
                          }}>
                          {prod.image ? (
                            <div style={{ width: '100%', aspectRatio: '1/1', overflow: 'hidden', backgroundColor: '#F1F1F1' }}>
                              <img src={prod.image} alt={prod.name} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
                            </div>
                          ) : (
                            <div style={{ width: '100%', aspectRatio: '1/1', backgroundColor: '#F1F1F1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px' }}>📦</div>
                          )}
                          {selected && (
                            <div style={{ position: 'absolute', top: '5px', right: '5px', width: '20px', height: '20px', borderRadius: '50%', backgroundColor: C.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 'bold', color: '#fff', animation: 'popIn 0.2s ease' }}>✓</div>
                          )}
                          {outOfStock && (
                            <div style={{ position: 'absolute', top: '5px', left: '5px', backgroundColor: '#DC2626', color: '#fff', fontSize: '9px', fontWeight: '800', padding: '2px 5px', borderRadius: '3px', textTransform: 'uppercase' }}>No stock</div>
                          )}
                          <div style={{ padding: '6px 8px', backgroundColor: selected ? C.accentFaint : '#FFFFFF' }}>
                            <div style={{ fontWeight: '600', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: selected ? C.accent : '#1A1A1A' }}>{prod.name}</div>
                            <div style={{ fontSize: '10px', color: '#9CA3AF', marginTop: '1px' }}>
                              €{prod.price.toFixed(2)}
                              {selected?.selectedVariant && selected.selectedVariant.title !== 'Default Title' && (
                                <span style={{ color: C.accent, fontWeight: '700', marginLeft: '3px' }}>· {selected.selectedVariant.title}</span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Variant picker dropdown */}
                        {isExpanded && !isSingle && (
                          <div style={{ border: `2px solid ${C.accent}`, borderTop: 'none', borderRadius: '0 0 8px 8px', padding: '8px', backgroundColor: '#FFFFFF', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                            <div style={{ width: '100%', fontSize: '10px', fontWeight: '700', color: '#9CA3AF', textTransform: 'uppercase', marginBottom: '3px' }}>Pick a size</div>
                            {prod.variants.map(v => (
                              <button key={v.id} type="button" onClick={() => v.available && selectVariant(prod, v)} style={{
                                padding: '3px 8px', fontSize: '11px', fontWeight: '700',
                                border: `1.5px solid ${v.available ? '#E3E3E3' : '#F3F4F6'}`,
                                borderRadius: '5px', cursor: v.available ? 'pointer' : 'not-allowed',
                                backgroundColor: v.available ? '#FFFFFF' : '#F9FAFB',
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

              {/* Right: Seeding Bag (drop zone) */}
              <div
                onDragOver={handleBagDragOver}
                onDragLeave={handleBagDragLeave}
                onDrop={handleBagDrop}
                style={{
                  width: '252px', flexShrink: 0,
                  position: 'sticky', top: '16px',
                  minHeight: '400px',
                  border: `2px ${dragOver ? 'solid' : 'dashed'} ${dragOver ? C.accent : '#E3E3E3'}`,
                  borderRadius: '14px',
                  backgroundColor: dragOver ? C.accentFaint : '#FAFAFA',
                  transition: 'all 0.2s ease',
                  display: 'flex', flexDirection: 'column', overflow: 'hidden',
                  boxShadow: dragOver ? `0 0 0 4px rgba(217,119,87,0.12)` : 'none',
                }}>

                {/* Bag header */}
                <div style={{ padding: '14px 16px 10px', borderBottom: selectedProducts.length > 0 ? '1px solid #F3F4F6' : 'none', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '20px' }}>🎁</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '13px', fontWeight: '800', color: '#1A1A1A' }}>Seeding Bag</div>
                    <div style={{ fontSize: '11px', color: '#9CA3AF' }}>
                      {selectedProducts.length === 0 ? 'Drag products here' : `${selectedProducts.length} item${selectedProducts.length !== 1 ? 's' : ''} selected`}
                    </div>
                  </div>
                  {selectedProducts.length > 0 && (
                    <div style={{ width: '22px', height: '22px', borderRadius: '50%', backgroundColor: C.accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '900', animation: 'popIn 0.2s ease' }}>
                      {selectedProducts.length}
                    </div>
                  )}
                </div>

                {/* Items / empty state */}
                <div style={{ flex: 1, padding: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {selectedProducts.length === 0 ? (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '20px 0', color: '#D1D5DB' }}>
                      <div style={{ fontSize: '40px', opacity: dragOver ? 1 : 0.45, transform: dragOver ? 'scale(1.25) rotate(-5deg)' : 'scale(1)', transition: 'all 0.25s ease' }}>📦</div>
                      <div style={{ fontSize: '12px', textAlign: 'center', color: dragOver ? C.accent : '#9CA3AF', fontWeight: dragOver ? '700' : '400', transition: 'color 0.2s' }}>
                        {dragOver ? '✨ Drop it!' : 'Drag products here\nor click to select'}
                      </div>
                    </div>
                  ) : (
                    selectedProducts.map(p => {
                      const hasSize = !!p.size;
                      const sizeWarning = !hasSize;
                      return (
                        <div key={p.id} className="bag-item" style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px', backgroundColor: sizeWarning ? '#FEF3F2' : '#FFFFFF', border: `1px solid ${sizeWarning ? '#FCA5A5' : '#F3F4F6'}`, borderRadius: '8px' }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                            {p.image ? (
                              <img src={p.image} alt={p.name} style={{ width: '34px', height: '34px', objectFit: 'contain', borderRadius: '5px', backgroundColor: '#F9FAFB', flexShrink: 0 }} />
                            ) : (
                              <div style={{ width: '34px', height: '34px', backgroundColor: '#E5E7EB', borderRadius: '5px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0 }}>📦</div>
                            )}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: '11px', fontWeight: '700', color: '#1A1A1A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                              <div style={{ fontSize: '10px', color: '#9CA3AF' }}>
                                €{(p.selectedVariant?.price ?? p.price).toFixed(2)}
                                {p.selectedVariant && p.selectedVariant.title !== 'Default Title' && (
                                  <span style={{ color: C.accent, fontWeight: '600', marginLeft: '3px' }}>· {p.selectedVariant.title}</span>
                                )}
                              </div>
                            </div>
                            <button type="button" className="remove-btn" onClick={() => removeProduct(p.id)}
                              style={{ background: 'none', border: 'none', color: '#D1D5DB', cursor: 'pointer', fontSize: '18px', lineHeight: 1, padding: '2px', flexShrink: 0, transition: 'color 0.15s' }}>
                              ×
                            </button>
                          </div>
                          {/* Size selector - only show if variants exist */}
                          {p.variants && p.variants.length > 1 && (
                            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', paddingTop: '2px' }}>
                              {p.variants.map(v => {
                                const vSize = extractSizeFromVariant(v.title);
                                const isSelected = p.size === vSize;
                                if (!vSize) return null;
                                return (
                                  <button
                                    key={v.id}
                                    type="button"
                                    onClick={() => updateProductSize(p.id, vSize)}
                                    style={{
                                      padding: '3px 7px',
                                      fontSize: '9px',
                                      fontWeight: isSelected ? '700' : '600',
                                      border: `1.5px solid ${isSelected ? C.accent : '#E3E3E3'}`,
                                      backgroundColor: isSelected ? C.accentFaint : '#FFFFFF',
                                      color: isSelected ? C.accent : '#6B7280',
                                      borderRadius: '4px',
                                      cursor: v.available ? 'pointer' : 'not-allowed',
                                      opacity: v.available ? 1 : 0.5,
                                      transition: 'all 0.15s ease',
                                    }}
                                  >
                                    {vSize}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          {sizeWarning && (
                            <div style={{ fontSize: '9px', color: '#DC2626', fontWeight: '600', marginTop: '2px' }}>
                              ⚠️ Size required
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Totals */}
                {selectedProducts.length > 0 && (
                  <div style={{ padding: '12px 16px', borderTop: '1px solid #F3F4F6', backgroundColor: '#F9FAFB' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#6B7280', marginBottom: '3px' }}>
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

            {/* Step 2 footer nav */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '24px', paddingTop: '20px', borderTop: '1px solid #E3E3E3', flexWrap: 'wrap', gap: '12px' }}>
              <button type="button" onClick={() => setStep(1)} style={{ ...btn.secondary }}>← Back</button>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {getProductsWithoutSize(selectedProducts).length > 0 && (
                  <div style={{ fontSize: '12px', color: '#DC2626', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    ⚠️ {getProductsWithoutSize(selectedProducts).length} item{getProductsWithoutSize(selectedProducts).length !== 1 ? 's' : ''} need{getProductsWithoutSize(selectedProducts).length === 1 ? 's' : ''} sizes
                  </div>
                )}
                <button type="button" onClick={() => setStep(3)} disabled={selectedProducts.length === 0 || getProductsWithoutSize(selectedProducts).length > 0}
                  style={{ ...btn.primary, opacity: selectedProducts.length > 0 && getProductsWithoutSize(selectedProducts).length === 0 ? 1 : 0.35, cursor: selectedProducts.length > 0 && getProductsWithoutSize(selectedProducts).length === 0 ? 'pointer' : 'not-allowed', fontSize: '14px', padding: '10px 24px' }}>
                  Next: Review →
                </button>
              </div>
            </div>
          </>
        )}

        {/* ══════════════════ STEP 3 — REVIEW ══════════════════ */}
        {step === 3 && (
          <div style={{ animation: 'fadeInUp 0.3s ease', maxWidth: '600px' }}>

            {/* Summary card */}
            <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E3E3E3', borderRadius: '14px', padding: '20px', marginBottom: '18px' }}>
              {/* Influencer row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', paddingBottom: '16px', borderBottom: '1px solid #F3F4F6' }}>
                <div style={{ width: '46px', height: '46px', borderRadius: '50%', backgroundColor: avatarBg(selectedInfluencer?.handle || ''), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', fontWeight: '800', flexShrink: 0 }}>
                  {initials(selectedInfluencer?.name || selectedInfluencer?.handle || '')}
                </div>
                <div>
                  <div style={{ fontSize: '16px', fontWeight: '800', color: '#1A1A1A' }}>{selectedInfluencer?.handle}</div>
                  {selectedInfluencer?.name && <div style={{ fontSize: '12px', color: '#6B7280' }}>{selectedInfluencer.name}</div>}
                </div>
                {selectedCampaign && (
                  <div style={{ marginLeft: 'auto', padding: '5px 12px', backgroundColor: C.accentFaint, color: C.accent, fontSize: '12px', fontWeight: '700', borderRadius: '20px' }}>
                    📁 {selectedCampaign.title}
                  </div>
                )}
              </div>

              {/* Products */}
              <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.6px', color: '#9CA3AF', marginBottom: '10px' }}>
                🎁 Products ({selectedProducts.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px', marginBottom: '18px' }}>
                {selectedProducts.map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 10px 5px 6px', border: '1px solid #E3E3E3', backgroundColor: '#F9FAFB', borderRadius: '8px' }}>
                    {p.image && <img src={p.image} alt={p.name} style={{ width: '24px', height: '24px', objectFit: 'contain', borderRadius: '3px' }} />}
                    <span style={{ fontSize: '12px', fontWeight: '600', color: '#1A1A1A' }}>{p.name}</span>
                    {p.selectedVariant && p.selectedVariant.title !== 'Default Title' && (
                      <span style={{ fontSize: '11px', color: C.accent, fontWeight: '700' }}>{p.selectedVariant.title}</span>
                    )}
                    {p.size && (
                      <span style={{ fontSize: '10px', fontWeight: '600', backgroundColor: '#EDE9FE', color: '#7C3AED', padding: '1px 6px', borderRadius: '4px' }}>
                        {p.size}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {/* Totals */}
              <div style={{ display: 'flex', gap: '24px' }}>
                <div>
                  <div style={{ fontSize: '11px', color: '#9CA3AF', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>Retail Value</div>
                  <div style={{ fontSize: '22px', fontWeight: '900', color: C.accent }}>€{totalRetail.toFixed(2)}</div>
                </div>
                {totalCost > 0 && (
                  <div>
                    <div style={{ fontSize: '11px', color: '#9CA3AF', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>Your Cost</div>
                    <div style={{ fontSize: '22px', fontWeight: '900', color: '#1A1A1A' }}>€{totalCost.toFixed(2)}</div>
                  </div>
                )}
              </div>
            </div>

            {/* Timeline */}
            <div style={{ backgroundColor: '#FFFBF9', border: `1px solid rgba(217,119,87,0.25)`, borderRadius: '12px', padding: '16px', marginBottom: '18px' }}>
              <div style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.7px', color: C.accent, marginBottom: '12px' }}>
                ✨ What happens next
              </div>
              {[['🛒','A Shopify draft order is created with 100% discount'],['🔗','You get a checkout link to share with the influencer'],['📦','They fill their own address and check out for free'],['✅','Your fulfillment center receives the order automatically']].map(([icon, text]) => (
                <div key={text} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '8px' }}>
                  <span style={{ fontSize: '16px', flexShrink: 0, lineHeight: '20px' }}>{icon}</span>
                  <span style={{ fontSize: '13px', color: '#6B7280', lineHeight: '20px' }}>{text}</span>
                </div>
              ))}
            </div>

            {/* Notes */}
            <label style={{ display: 'block', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.6px', color: '#6B7280', marginBottom: '6px' }}>
              Notes / Brief <span style={{ fontWeight: '400', textTransform: 'none', color: '#9CA3AF', marginLeft: '4px' }}>— optional</span>
            </label>
            <textarea name="notes" rows={3} placeholder="Campaign notes, content directions, what to post…"
              style={{ display: 'block', width: '100%', padding: '10px 12px', border: '1px solid #E3E3E3', backgroundColor: '#FAFAFA', color: '#1A1A1A', fontSize: '13px', borderRadius: '8px', fontFamily: 'system-ui', resize: 'vertical', boxSizing: 'border-box', marginBottom: '24px', outline: 'none' }} />

            {/* Actions */}
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <button type="button" onClick={() => setStep(2)} style={{ ...btn.secondary }}>← Back</button>
              <button type="submit" style={{ ...btn.primary, fontSize: '14px', padding: '12px 28px', borderRadius: '8px', background: `linear-gradient(135deg, ${C.accent} 0%, #C86845 100%)`, boxShadow: '0 4px 16px rgba(217,119,87,0.35)', border: 'none' }}>
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
