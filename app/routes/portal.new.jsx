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
import { btn, input, fmtNum } from '../theme';
import { D } from '../utils/portal-theme';
import { guessProductCategory, extractSizeFromVariant } from '../utils/size-helpers';

// ── Loader ────────────────────────────────────────────────────────────────────
export async function loader({ request }) {
  const { shop, portalUser } = await requirePortalUser(request);
  requirePermission(portalUser.role, 'createSeeding');

  // Fetch Shopify products using stored offline access token
  let products = [];
  try {
    const session = await prisma.session.findFirst({
      where:   { shop, isOnline: false },
      orderBy: { expires: 'desc' },
    });
    if (session?.accessToken) {
      const res  = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': session.accessToken },
        body: JSON.stringify({
          query: `query GetProducts {
            products(first: 100) {
              edges { node {
                id title totalInventory
                featuredImage { url }
                collections(first: 5) { edges { node { title } } }
                variants(first: 30) { edges { node {
                  id title price availableForSale
                  inventoryItem { unitCost { amount } }
                } } }
              } }
            }
          }`,
        }),
      });
      const body = await res.json();
      products = (body?.data?.products?.edges ?? []).map(edge => ({
        id:          edge.node.id,
        name:        edge.node.title,
        image:       edge.node.featuredImage?.url ?? null,
        stock:       edge.node.totalInventory ?? 0,
        collections: edge.node.collections.edges.map(c => c.node.title),
        variants:    edge.node.variants.edges.map(v => ({
          id:        v.node.id,
          title:     v.node.title,
          price:     parseFloat(v.node.price || 0),
          cost:      parseFloat(v.node.inventoryItem?.unitCost?.amount || 0) || null,
          available: v.node.availableForSale,
        })),
        price:     parseFloat(edge.node.variants.edges[0]?.node?.price || 0),
        cost:      parseFloat(edge.node.variants.edges[0]?.node?.inventoryItem?.unitCost?.amount || 0) || null,
        variantId: edge.node.variants.edges[0]?.node?.id ?? null,
      }));
    }
  } catch (e) {
    console.error('Portal: failed to fetch Shopify products:', e.message);
  }

  const influencers = await prisma.influencer.findMany({
    where: { archived: false }, orderBy: { name: 'asc' },
  });
  const campaigns = await prisma.campaign.findMany({
    where: { shop }, orderBy: { createdAt: 'desc' }, include: { products: true },
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
    const savedSizes = await prisma.influencerSavedSize.findMany();
    for (const ss of savedSizes) {
      if (!allSavedSizes[ss.influencerId]) allSavedSizes[ss.influencerId] = {};
      allSavedSizes[ss.influencerId][ss.category] = ss.size;
    }
  } catch (e) {
    console.warn('influencerSavedSize table not ready:', e.message);
  }

  return { products, influencers, campaigns, recentlySeededMap, allSavedSizes, shop };
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

  let shopifyDraftOrderId = null;
  let shopifyOrderName    = null;
  let invoiceUrl          = null;

  try {
    const session = await prisma.session.findFirst({
      where: { shop, isOnline: false }, orderBy: { expires: 'desc' },
    });
    if (session?.accessToken) {
      const lineItems = variantIds.filter(v => v && v.length > 0).map(variantId => ({ variantId, quantity: 1 }));
      const mutation  = `mutation DraftOrderCreate($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) {
          draftOrder { id name invoiceUrl }
          userErrors { field message }
        }
      }`;
      const res  = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': session.accessToken },
        body: JSON.stringify({ query: mutation, variables: {
          input: {
            lineItems,
            appliedDiscount: { value: 100, valueType: 'PERCENTAGE', title: 'Seeding Gift – 100% Off' },
            note: `Seeding for ${influencer?.handle ?? ''} (${influencer?.name ?? ''})`,
            tags: ['seeding'],
          },
        }}),
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

// ── Component ─────────────────────────────────────────────────────────────────
// Reuse the same UI logic as app.new.jsx but pointing to portal routes
export default function PortalNewSeeding() {
  const { products, influencers, campaigns, recentlySeededMap, allSavedSizes, shop } = useLoaderData();
  const navigate = useNavigate();

  const [selectedInfluencer, setSelectedInfluencer] = useState(null);
  const [selectedCampaign,   setSelectedCampaign]   = useState(null);
  const [selectedProducts,   setSelectedProducts]   = useState([]);
  const [notes,              setNotes]              = useState('');
  const [infSearch,          setInfSearch]          = useState('');
  const [search,             setSearch]             = useState('');
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

  const campaignProductIds = selectedCampaign
    ? new Set(selectedCampaign.products.map(cp => cp.productId))
    : null;

  const visibleProducts = campaignProductIds
    ? products.filter(p => campaignProductIds.has(p.id))
    : products;

  const filteredProducts = visibleProducts.filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase())
  );

  function handleDrop(prod) {
    if (selectedProducts.find(p => p.id === prod.id)) return;
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
        matchedVariant  = match.available !== false ? match : null;
        sizeUnavailable = match.available === false;
      } else {
        sizeUnavailable = true;
      }
    }
    setSelectedProducts(prev => [...prev, {
      ...prod,
      selectedVariant: matchedVariant,
      category,
      size:            matchedVariant ? extractSizeFromVariant(matchedVariant.title) : null,
      sizeUnavailable,
    }]);
  }

  const totalCost = selectedProducts.reduce((sum, p) => sum + (p.selectedVariant?.price ?? p.price ?? 0), 0);
  const allHaveSizes = selectedProducts.every(p => p.size);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!selectedInfluencer) { setSubmitError('Select an influencer first.'); return; }
    if (selectedProducts.length === 0) { setSubmitError('Add at least one product.'); return; }
    if (!allHaveSizes) { setSubmitError('All products must have a size selected.'); return; }
    setSubmitting(true);
    setSubmitError(null);
    e.target.submit();
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2 style={{ margin: 0, color: D.text }}>New Seeding</h2>
        <button type="button" onClick={() => navigate('/portal/seedings')}
          style={{ ...btn.ghost }}>← Back</button>
      </div>

      <Form method="post" onSubmit={handleSubmit}>
        <input type="hidden" name="shop" value={shop} />
        <input type="hidden" name="influencerId" value={selectedInfluencer?.id ?? ''} />
        <input type="hidden" name="campaignId"   value={selectedCampaign?.id ?? ''} />
        {selectedProducts.map((p, i) => (
          <span key={p.id}>
            <input type="hidden" name="productIds"      value={p.id} />
            <input type="hidden" name="variantIds"      value={p.selectedVariant?.id ?? p.variantId ?? ''} />
            <input type="hidden" name="productNames"    value={p.name} />
            <input type="hidden" name="productPrices"   value={p.selectedVariant?.price ?? p.price ?? 0} />
            <input type="hidden" name="productCosts"    value={p.selectedVariant?.cost ?? p.cost ?? ''} />
            <input type="hidden" name="productImages"   value={p.image ?? ''} />
            <input type="hidden" name="productSizes"    value={p.size ?? ''} />
            <input type="hidden" name="productCategories" value={p.category ?? ''} />
          </span>
        ))}

        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '24px', alignItems: 'start' }}>
          {/* Left panel */}
          <div style={{ display: 'grid', gap: '16px' }}>
            {/* Influencer picker */}
            <div style={{ backgroundColor: D.surface, border: `1px solid ${D.border}`, borderRadius: '10px', padding: '16px' }}>
              <div style={{ fontWeight: '700', fontSize: '13px', color: D.text, marginBottom: '10px' }}>Influencer</div>
              <input type="text" placeholder="Search…" value={infSearch} onChange={e => setInfSearch(e.target.value)}
                style={{ ...input.base, width: '100%', marginBottom: '10px', boxSizing: 'border-box', fontSize: '13px' }} />
              <div style={{ maxHeight: '220px', overflowY: 'auto', display: 'grid', gap: '4px' }}>
                {influencers
                  .filter(inf => !infSearch || inf.handle.toLowerCase().includes(infSearch.toLowerCase()) || inf.name.toLowerCase().includes(infSearch.toLowerCase()))
                  .map(inf => (
                    <button key={inf.id} type="button"
                      onClick={() => setSelectedInfluencer(inf)}
                      style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '8px 10px', borderRadius: '6px', cursor: 'pointer', textAlign: 'left',
                        border: `1px solid ${selectedInfluencer?.id === inf.id ? D.accent : 'transparent'}`,
                        backgroundColor: selectedInfluencer?.id === inf.id ? D.accentFaint : 'transparent',
                        color: D.text,
                      }}>
                      <span style={{ fontSize: '13px', fontWeight: '600' }}>@{inf.handle}</span>
                      <span style={{ fontSize: '11px', color: D.textMuted }}>{inf.country}</span>
                    </button>
                  ))
                }
              </div>
            </div>

            {/* Campaign picker */}
            <div style={{ backgroundColor: D.surface, border: `1px solid ${D.border}`, borderRadius: '10px', padding: '16px' }}>
              <div style={{ fontWeight: '700', fontSize: '13px', color: D.text, marginBottom: '10px' }}>Campaign (optional)</div>
              <div style={{ display: 'grid', gap: '4px' }}>
                <button type="button" onClick={() => setSelectedCampaign(null)}
                  style={{ padding: '7px 10px', borderRadius: '6px', cursor: 'pointer', textAlign: 'left', fontSize: '13px', border: `1px solid ${!selectedCampaign ? D.accent : 'transparent'}`, backgroundColor: !selectedCampaign ? D.accentFaint : 'transparent', color: D.text, fontWeight: !selectedCampaign ? '700' : '400' }}>
                  No campaign
                </button>
                {campaigns.map(c => (
                  <button key={c.id} type="button" onClick={() => setSelectedCampaign(c)}
                    style={{ padding: '7px 10px', borderRadius: '6px', cursor: 'pointer', textAlign: 'left', fontSize: '13px', border: `1px solid ${selectedCampaign?.id === c.id ? D.accent : 'transparent'}`, backgroundColor: selectedCampaign?.id === c.id ? D.accentFaint : 'transparent', color: D.text }}>
                    {c.title}
                  </button>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div style={{ backgroundColor: D.surface, border: `1px solid ${D.border}`, borderRadius: '10px', padding: '16px' }}>
              <div style={{ fontWeight: '700', fontSize: '13px', color: D.text, marginBottom: '8px' }}>Notes</div>
              <textarea name="notes" value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                placeholder="Any notes about this seeding…"
                style={{ ...input.base, width: '100%', resize: 'vertical', boxSizing: 'border-box', fontSize: '13px' }} />
            </div>

            {/* Submit */}
            {submitError && (
              <div style={{ padding: '10px 14px', backgroundColor: '#FEF2F2', color: '#DC2626', borderRadius: '6px', fontSize: '13px', fontWeight: '600' }}>
                {submitError}
              </div>
            )}
            <button type="submit" disabled={submitting || !selectedInfluencer || selectedProducts.length === 0 || !allHaveSizes}
              style={{ ...btn.primary, opacity: (submitting || !selectedInfluencer || selectedProducts.length === 0 || !allHaveSizes) ? 0.5 : 1, cursor: (submitting || !selectedInfluencer || selectedProducts.length === 0 || !allHaveSizes) ? 'not-allowed' : 'pointer' }}>
              {submitting ? 'Creating…' : `Create Seeding${selectedProducts.length > 0 ? ` (${selectedProducts.length} product${selectedProducts.length !== 1 ? 's' : ''})` : ''}`}
            </button>
          </div>

          {/* Right panel — product picker + drop zone */}
          <div style={{ display: 'grid', gap: '16px' }}>
            {/* Product search */}
            <div style={{ backgroundColor: D.surface, border: `1px solid ${D.border}`, borderRadius: '10px', padding: '16px' }}>
              <input type="text" placeholder="🔍 Search products…" value={search} onChange={e => setSearch(e.target.value)}
                style={{ ...input.base, width: '100%', marginBottom: '12px', boxSizing: 'border-box' }} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '10px', maxHeight: '340px', overflowY: 'auto' }}>
                {filteredProducts.map(prod => {
                  const outOfStock    = prod.stock === 0;
                  const recentlySent  = !!(selectedInfluencer && recentlySeedMapForInfluencer[prod.id]);
                  const alreadyAdded  = selectedProducts.some(p => p.id === prod.id);
                  const isShaking     = shakeId === prod.id;
                  return (
                    <div key={prod.id}
                      draggable={!outOfStock && !recentlySent}
                      onDragStart={() => setDragProductId(prod.id)}
                      onDragEnd={() => setDragProductId(null)}
                      onClick={() => { if (!outOfStock && !recentlySent && !alreadyAdded) handleDrop(prod); }}
                      style={{
                        border: `1px solid ${alreadyAdded ? D.accent : D.border}`,
                        borderRadius: '8px', overflow: 'hidden', cursor: outOfStock || recentlySent ? 'not-allowed' : 'pointer',
                        opacity: outOfStock || recentlySent ? 0.45 : 1,
                        backgroundColor: alreadyAdded ? D.accentFaint : D.surface,
                        animation: isShaking ? 'shake 0.4s' : 'none',
                        transition: 'all 0.15s',
                      }}>
                      {prod.image && <img src={prod.image} alt={prod.name} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }} />}
                      <div style={{ padding: '8px' }}>
                        <div style={{ fontSize: '11px', fontWeight: '700', color: D.text, lineHeight: 1.3, marginBottom: '3px' }}>{prod.name}</div>
                        <div style={{ fontSize: '11px', color: D.textMuted }}>€{prod.price.toFixed(2)}</div>
                        {recentlySent && <div style={{ fontSize: '10px', color: D.accent, fontWeight: '700', marginTop: '2px' }}>Recently sent</div>}
                        {outOfStock && <div style={{ fontSize: '10px', color: '#DC2626', fontWeight: '700', marginTop: '2px' }}>Out of stock</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Drop zone */}
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => {
                e.preventDefault(); setDragOver(false);
                const prod = products.find(p => p.id === dragProductId);
                if (prod) handleDrop(prod);
              }}
              style={{
                border: `2px ${dragOver ? 'solid' : 'dashed'} ${dragOver ? D.accent : '#E3E3E3'}`,
                borderRadius: '10px', padding: '16px', minHeight: '120px',
                backgroundColor: dragOver ? D.accentFaint : '#FAFAFA',
                transition: 'all 0.2s',
              }}>
              {selectedProducts.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px', color: D.textMuted }}>
                  <div style={{ fontSize: '32px', marginBottom: '8px' }}>📦</div>
                  <div style={{ fontSize: '13px' }}>Drag products here or click them to add</div>
                </div>
              ) : (
                <div style={{ display: 'grid', gap: '10px' }}>
                  {selectedProducts.map((prod, i) => (
                    <div key={prod.id} style={{
                      display: 'grid', gridTemplateColumns: '48px 1fr auto', gap: '10px', alignItems: 'center',
                      backgroundColor: D.surface, border: `1px solid ${D.border}`, borderRadius: '8px', padding: '10px',
                    }}>
                      {prod.image && <img src={prod.image} alt={prod.name} style={{ width: '48px', height: '48px', objectFit: 'cover', borderRadius: '4px' }} />}
                      {!prod.image && <div style={{ width: '48px', height: '48px', backgroundColor: D.surfaceHigh, borderRadius: '4px' }} />}
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: '700', color: D.text }}>{prod.name}</div>
                        <div style={{ display: 'flex', gap: '6px', marginTop: '4px', flexWrap: 'wrap' }}>
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
                              style={{ fontSize: '12px', padding: '3px 6px', borderRadius: '4px', border: `1px solid ${!prod.size ? '#DC2626' : D.border}`, backgroundColor: !prod.size ? '#FEF2F2' : D.surface }}>
                              <option value="">Pick size</option>
                              {prod.variants.filter(v => v.available !== false).map(v => (
                                <option key={v.id} value={extractSizeFromVariant(v.title)}>
                                  {extractSizeFromVariant(v.title) || v.title}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span style={{ fontSize: '12px', color: D.textMuted }}>One size</span>
                          )}
                          <span style={{ fontSize: '12px', color: D.textMuted }}>€{(prod.selectedVariant?.price ?? prod.price).toFixed(2)}</span>
                        </div>
                      </div>
                      <button type="button"
                        onClick={() => setSelectedProducts(prev => prev.filter(p => p.id !== prod.id))}
                        style={{ background: 'none', border: 'none', color: D.textMuted, cursor: 'pointer', fontSize: '18px', lineHeight: 1 }}>×</button>
                    </div>
                  ))}
                  <div style={{ fontSize: '13px', fontWeight: '700', color: D.text, textAlign: 'right', paddingTop: '6px', borderTop: `1px solid ${D.border}` }}>
                    Total: €{totalCost.toFixed(2)}
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
