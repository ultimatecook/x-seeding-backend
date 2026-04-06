import { useState } from 'react';
import { useLoaderData, useRouteLoaderData, useNavigate, Form, redirect, useRouteError } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import prisma from '../db.server';
import { C, btn, input, card } from '../theme';

export async function loader() {
  const influencers = await prisma.influencer.findMany({ orderBy: { name: 'asc' } });
  const campaigns   = await prisma.campaign.findMany({
    orderBy: { createdAt: 'desc' },
    include: { products: true },
  });
  return { influencers, campaigns };
}

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
  const productImages = formData.getAll('productImages');
  const totalCost     = productPrices.reduce((sum, p) => sum + p, 0);
  const notes         = formData.get('notes') || '';

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
          imageUrl:    productImages[i] || null,
        })),
      },
    },
  });

  return redirect(campaignId ? `/app/campaigns/${campaignId}` : '/app');
}

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

  const campaignProductIds = selectedCampaign ? new Set(selectedCampaign.products.map(cp => cp.productId)) : null;
  const visibleProducts    = campaignProductIds ? products.filter(p => campaignProductIds.has(p.id)) : products;
  const allCollections     = ['All', ...new Set(visibleProducts.flatMap(p => p.collections))];
  const filteredProducts   = visibleProducts
    .filter(p => activeCollection === 'All' || p.collections.includes(activeCollection))
    .filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()));

  const selectVariant = (prod, variant) => {
    setSelectedProducts(prev => [...prev.filter(p => p.id !== prod.id), { ...prod, selectedVariant: variant }]);
    setExpandedProductId(null);
  };
  const removeProduct = (prodId) => setSelectedProducts(prev => prev.filter(p => p.id !== prodId));

  const handleCampaignSelect = (c) => {
    setSelectedCampaign(c);
    setSelectedProducts([]);
    setActiveCollection('All');
    setSearch('');
  };

  const totalCost = selectedProducts.reduce((sum, p) => sum + (p.selectedVariant?.price ?? p.price), 0);

  const StepDot = ({ n, label }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: step >= n ? C.accent : C.surfaceHigh, color: step >= n ? '#fff' : C.textMuted, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: '800', flexShrink: 0 }}>{n}</div>
      <span style={{ fontSize: '13px', color: step === n ? C.text : C.textMuted, fontWeight: step === n ? '700' : '400' }}>{label}</span>
      {n < 3 && <span style={{ color: C.border, margin: '0 4px' }}>›</span>}
    </div>
  );

  const infBtn = (active) => ({
    padding: '12px 16px',
    backgroundColor: active ? C.accentFaint : C.surface,
    color: active ? C.accent : C.text,
    border: `1px solid ${active ? C.accent : C.border}`,
    cursor: 'pointer',
    textAlign: 'left',
    borderRadius: '8px',
    width: '100%',
    marginBottom: '8px',
  });

  return (
    <div>
      <Form method="post">
        <div style={{ maxWidth: '720px', marginBottom: '36px' }}>
          <h2 style={{ marginTop: 0, marginBottom: '24px', color: C.text }}>New Seeding</h2>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <StepDot n={1} label="Influencer" />
            <StepDot n={2} label="Products" />
            <StepDot n={3} label="Details" />
          </div>
        </div>

        <input type="hidden" name="shop" value={shop} />
        {selectedInfluencer && <input type="hidden" name="influencerId" value={selectedInfluencer.id} />}
        {selectedCampaign   && <input type="hidden" name="campaignId"   value={selectedCampaign.id} />}
        {selectedProducts.map(p => (
          <span key={p.id}>
            <input type="hidden" name="productIds"    value={p.id} />
            <input type="hidden" name="variantIds"    value={p.selectedVariant?.id ?? p.variantId ?? ''} />
            <input type="hidden" name="productNames"  value={`${p.name}${p.selectedVariant && p.selectedVariant.title !== 'Default Title' ? ` – ${p.selectedVariant.title}` : ''}`} />
            <input type="hidden" name="productPrices" value={p.selectedVariant?.price ?? p.price} />
            <input type="hidden" name="productImages" value={p.image ?? ''} />
          </span>
        ))}

        {/* ── Step 1 ── */}
        {step === 1 && (
          <div style={{ maxWidth: '720px' }}>
            {campaigns.length > 0 && (
              <div style={{ marginBottom: '28px' }}>
                <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.6px', color: C.textSub, marginBottom: '10px' }}>
                  Add to Campaign <span style={{ fontWeight: '400', textTransform: 'none', color: C.textMuted }}>— optional</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {campaigns.map(c => {
                    const active = selectedCampaign?.id === c.id;
                    return (
                      <button key={c.id} type="button" onClick={() => handleCampaignSelect(active ? null : c)}
                        style={{ padding: '7px 16px', fontSize: '13px', fontWeight: '600', border: `1px solid ${active ? C.accent : C.border}`, cursor: 'pointer', borderRadius: '20px', backgroundColor: active ? C.accentFaint : 'transparent', color: active ? C.accent : C.textSub }}>
                        {active ? '✓ ' : ''}{c.title}
                        {c.budget != null && <span style={{ fontWeight: '400', opacity: 0.6, marginLeft: '6px', fontSize: '11px' }}>€{c.budget.toLocaleString()}</span>}
                      </button>
                    );
                  })}
                </div>
                {selectedCampaign && (
                  <div style={{ marginTop: '8px', fontSize: '12px', color: C.textMuted }}>
                    Products will be filtered to this campaign's {selectedCampaign.products.length} product{selectedCampaign.products.length !== 1 ? 's' : ''}.
                  </div>
                )}
              </div>
            )}

            <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.6px', color: C.textSub, marginBottom: '10px' }}>Select Influencer</div>
            {influencers.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', border: `2px dashed ${C.border}`, color: C.textMuted, borderRadius: '8px' }}>
                <p style={{ margin: '0 0 12px' }}>No influencers yet.</p>
                <a href="/app/influencers" style={{ color: C.accent, fontWeight: '700', textDecoration: 'none' }}>Add influencers first →</a>
              </div>
            ) : (
              influencers.map(inf => (
                <button type="button" key={inf.id} onClick={() => setSelectedInfluencer(inf)} style={infBtn(selectedInfluencer?.id === inf.id)}>
                  <span style={{ fontWeight: '700' }}>{inf.handle}</span>
                  <span style={{ fontSize: '12px', opacity: 0.6, marginLeft: '8px' }}>{inf.name} · {inf.followers?.toLocaleString()} followers · {inf.country}</span>
                </button>
              ))
            )}
            <div style={{ display: 'flex', gap: '8px', marginTop: '24px' }}>
              <button type="button" onClick={() => navigate('/app')} style={{ ...btn.secondary }}>Cancel</button>
              <button type="button" onClick={() => setStep(2)} disabled={!selectedInfluencer}
                style={{ ...btn.primary, opacity: selectedInfluencer ? 1 : 0.4, cursor: selectedInfluencer ? 'pointer' : 'not-allowed' }}>
                Next →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2 ── */}
        {step === 2 && (
          <div style={{ width: '100%' }}>
            {selectedCampaign && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 14px', backgroundColor: C.accentFaint, color: C.accent, fontSize: '12px', fontWeight: '700', marginBottom: '16px', borderRadius: '6px' }}>
                📁 {selectedCampaign.title}
                <span style={{ fontWeight: '400', opacity: 0.7 }}>· {selectedCampaign.products.length} products</span>
              </div>
            )}

            <input type="text" placeholder="Search products..." value={search} onChange={e => setSearch(e.target.value)}
              style={{ ...input.base, marginBottom: '12px', width: '100%' }} />

            {allCollections.length > 1 && (
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '16px' }}>
                {allCollections.map(col => (
                  <button key={col} type="button" onClick={() => setActiveCollection(col)}
                    style={{ padding: '5px 14px', fontSize: '12px', fontWeight: '600', border: `1px solid ${activeCollection === col ? C.accent : C.border}`, cursor: 'pointer', borderRadius: '20px', backgroundColor: activeCollection === col ? C.accentFaint : 'transparent', color: activeCollection === col ? C.accent : C.textSub }}>
                    {col}
                  </button>
                ))}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: '8px', marginBottom: '20px', width: '100%' }}>
              {filteredProducts.map(prod => {
                const selected       = selectedProducts.find(p => p.id === prod.id);
                const outOfStock     = prod.stock <= 0;
                const isExpanded     = expandedProductId === prod.id;
                const isSingleVariant = prod.variants.length === 1 && prod.variants[0].title === 'Default Title';

                return (
                  <div key={prod.id} style={{ display: 'flex', flexDirection: 'column' }}>
                    <button type="button"
                      onClick={() => {
                        if (outOfStock) return;
                        if (selected) { removeProduct(prod.id); setExpandedProductId(null); }
                        else if (isSingleVariant) { selectVariant(prod, prod.variants[0]); }
                        else { setExpandedProductId(isExpanded ? null : prod.id); }
                      }}
                      style={{ padding: 0, backgroundColor: outOfStock ? C.surfaceHigh : selected ? C.accentFaint : isExpanded ? C.surfaceHigh : C.surface, border: `2px solid ${outOfStock ? C.borderLight : selected ? C.accent : isExpanded ? C.accent : C.border}`, cursor: outOfStock ? 'not-allowed' : 'pointer', textAlign: 'left', borderRadius: isExpanded ? '6px 6px 0 0' : '6px', overflow: 'hidden', position: 'relative', opacity: outOfStock ? 0.4 : 1 }}>
                      {prod.image ? (
                        <div style={{ width: '100%', aspectRatio: '1/1', backgroundColor: C.overlay, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                          <img src={prod.image} alt={prod.name} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
                        </div>
                      ) : (
                        <div style={{ width: '100%', aspectRatio: '1/1', backgroundColor: C.surfaceHigh, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px' }}>📦</div>
                      )}
                      {selected && (
                        <div style={{ position: 'absolute', top: '6px', right: '6px', width: '18px', height: '18px', borderRadius: '50%', backgroundColor: C.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 'bold', color: '#fff' }}>✓</div>
                      )}
                      {outOfStock && (
                        <div style={{ position: 'absolute', top: '5px', left: '5px', backgroundColor: C.errorText, color: '#fff', fontSize: '9px', fontWeight: '800', padding: '2px 5px', borderRadius: '3px', textTransform: 'uppercase' }}>No stock</div>
                      )}
                      <div style={{ padding: '7px 8px', backgroundColor: selected ? C.accentFaint : C.surface }}>
                        <div style={{ fontWeight: '600', fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: selected ? C.accent : C.text }}>{prod.name}</div>
                        <div style={{ fontSize: '11px', color: C.textMuted }}>
                          €{prod.price.toFixed(2)}
                          {selected?.selectedVariant && selected.selectedVariant.title !== 'Default Title' && (
                            <span style={{ marginLeft: '4px', color: C.accent, fontWeight: '700' }}>· {selected.selectedVariant.title}</span>
                          )}
                        </div>
                      </div>
                    </button>

                    {isExpanded && !isSingleVariant && (
                      <div style={{ border: `2px solid ${C.accent}`, borderTop: 'none', borderRadius: '0 0 6px 6px', padding: '8px', backgroundColor: C.surface, display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {prod.variants.map(v => (
                          <button key={v.id} type="button" onClick={() => v.available && selectVariant(prod, v)}
                            style={{ padding: '4px 8px', fontSize: '11px', fontWeight: '700', border: `1px solid ${v.available ? C.border : C.borderLight}`, borderRadius: '4px', cursor: v.available ? 'pointer' : 'not-allowed', backgroundColor: 'transparent', color: v.available ? C.text : C.textMuted, textDecoration: !v.available ? 'line-through' : 'none' }}>
                            {v.title}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {selectedProducts.length > 0 && (
              <div style={{ marginBottom: '20px', padding: '12px 16px', backgroundColor: C.accentFaint, border: `1px solid ${C.accent}`, borderRadius: '8px', fontSize: '13px' }}>
                <strong style={{ color: C.accent }}>{selectedProducts.length} product{selectedProducts.length !== 1 ? 's' : ''}</strong>
                <span style={{ color: C.textSub }}> selected · Total: </span>
                <strong style={{ color: C.text }}>€{totalCost.toFixed(2)}</strong>
                <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {selectedProducts.map(p => (
                    <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 10px', backgroundColor: C.surfaceHigh, color: C.text, borderRadius: '20px', fontSize: '11px', fontWeight: '600', border: `1px solid ${C.border}` }}>
                      {p.name}{p.selectedVariant && p.selectedVariant.title !== 'Default Title' ? ` – ${p.selectedVariant.title}` : ''}
                      <button type="button" onClick={() => removeProduct(p.id)} style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', padding: '0', fontSize: '13px', lineHeight: 1 }}>×</button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="button" onClick={() => setStep(1)} style={{ ...btn.secondary }}>← Back</button>
              <button type="button" onClick={() => setStep(3)} disabled={selectedProducts.length === 0}
                style={{ ...btn.primary, opacity: selectedProducts.length > 0 ? 1 : 0.4, cursor: selectedProducts.length > 0 ? 'pointer' : 'not-allowed' }}>
                Next →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3 ── */}
        {step === 3 && (
          <div style={{ maxWidth: '720px' }}>
            <div style={{ padding: '16px', backgroundColor: C.surface, border: `1px solid ${C.border}`, borderRadius: '8px', marginBottom: '24px' }}>
              <div style={{ fontSize: '14px', fontWeight: '700', marginBottom: '4px', color: C.text }}>{selectedInfluencer?.handle}</div>
              {selectedCampaign && <div style={{ fontSize: '12px', color: C.accent, marginBottom: '4px' }}>📁 {selectedCampaign.title}</div>}
              <div style={{ fontSize: '12px', color: C.textSub, marginBottom: '4px' }}>{selectedProducts.map(p => `${p.name}${p.selectedVariant && p.selectedVariant.title !== 'Default Title' ? ` (${p.selectedVariant.title})` : ''}`).join(', ')}</div>
              <div style={{ fontSize: '14px', fontWeight: '800', color: C.accent }}>€{totalCost.toFixed(2)}</div>
            </div>

            <div style={{ padding: '16px', border: `1px solid ${C.border}`, backgroundColor: C.surfaceHigh, borderRadius: '8px', marginBottom: '24px' }}>
              <div style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.6px', color: C.accent, marginBottom: '12px' }}>What happens when you click Create</div>
              {['🛒  A Shopify order is created with 100% discount', '🔗  You get a checkout link to share with the influencer', '📦  They fill their own address and check out for free', '✅  Your fulfillment center receives the order automatically'].map(line => (
                <div key={line} style={{ fontSize: '13px', color: C.textSub, marginBottom: '6px' }}>{line}</div>
              ))}
            </div>

            <label style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.6px', color: C.textSub }}>
              Notes / Brief <span style={{ fontWeight: '400', textTransform: 'none', color: C.textMuted }}>(optional)</span>
              <textarea name="notes" rows={3} placeholder="Campaign notes, content directions, what to post..."
                style={{ display: 'block', marginTop: '6px', width: '100%', padding: '10px 12px', border: `1px solid ${C.border}`, backgroundColor: C.overlay, color: C.text, fontSize: '13px', borderRadius: '6px', fontFamily: 'system-ui', resize: 'vertical', boxSizing: 'border-box' }} />
            </label>

            <div style={{ display: 'flex', gap: '8px', marginTop: '28px' }}>
              <button type="button" onClick={() => setStep(2)} style={{ ...btn.secondary }}>← Back</button>
              <button type="submit" style={{ ...btn.primary, fontSize: '14px', padding: '11px 28px' }}>
                Create Seeding + Generate Link →
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
