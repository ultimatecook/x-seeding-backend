import { useState } from 'react';
import { useLoaderData, useRouteLoaderData, useNavigate, Form, redirect, useRouteError } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import prisma from '../db.server';

export async function loader() {
  const influencers = await prisma.influencer.findMany({ orderBy: { name: 'asc' } });
  return { influencers };
}

export async function action({ request }) {
  const formData = await request.formData();

  const influencerId = parseInt(formData.get('influencerId'));
  const shop         = formData.get('shop') || '';
  const productIds   = formData.getAll('productIds');
  const variantIds   = formData.getAll('variantIds');
  const productNames = formData.getAll('productNames');
  const productPrices = formData.getAll('productPrices').map(Number);
  const productImages = formData.getAll('productImages');
  const totalCost    = productPrices.reduce((sum, p) => sum + p, 0);
  const notes        = formData.get('notes') || '';

  const influencer = await prisma.influencer.findUnique({ where: { id: influencerId } });

  // --- Create Shopify draft order and get invoice link ---
  let shopifyDraftOrderId = null;
  let shopifyOrderName    = null;
  let invoiceUrl          = null;

  try {
    const session = await prisma.session.findFirst({
      where: { shop },
      orderBy: { expires: 'desc' },
    });

    if (session?.accessToken) {
      const lineItems = variantIds
        .filter(v => v && v.length > 0)
        .map((variantId) => ({ variantId, quantity: 1 }));

      const mutation = `
        mutation DraftOrderCreate($input: DraftOrderInput!) {
          draftOrderCreate(input: $input) {
            draftOrder {
              id
              name
              invoiceUrl
            }
            userErrors { field message }
          }
        }
      `;

      const variables = {
        input: {
          lineItems,
          appliedDiscount: {
            value: 100,
            valueType: 'PERCENTAGE',
            title: 'Seeding Gift – 100% Off',
          },
          note: `Seeding for ${influencer?.handle ?? ''} (${influencer?.name ?? ''})`,
          tags: ['seeding'],
        },
      };

      const res  = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': session.accessToken,
        },
        body: JSON.stringify({ query: mutation, variables }),
      });

      const body  = await res.json();
      const draft = body?.data?.draftOrderCreate?.draftOrder;

      if (draft) {
        shopifyDraftOrderId = draft.id;
        shopifyOrderName    = draft.name;
        invoiceUrl          = draft.invoiceUrl;
      } else {
        console.error('Draft order errors:', body?.data?.draftOrderCreate?.userErrors);
      }
    }
  } catch (err) {
    console.error('Failed to create Shopify draft order:', err);
  }

  await prisma.seeding.create({
    data: {
      shop,
      influencerId,
      totalCost,
      notes,
      status: 'Pending',
      shopifyDraftOrderId,
      shopifyOrderName,
      invoiceUrl,
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

  return redirect('/app');
}

const inputStyle = {
  display: 'block', width: '100%', marginTop: '6px',
  padding: '10px', border: '1px solid #ddd',
  fontSize: '13px', boxSizing: 'border-box',
};

const btn = (active) => ({
  padding: '12px 16px',
  backgroundColor: active ? '#000' : '#f5f5f5',
  color: active ? '#fff' : '#000',
  border: 'none', cursor: 'pointer',
  textAlign: 'left', borderRadius: '4px',
  width: '100%', marginBottom: '8px',
});

export default function NewSeeding() {
  const { influencers } = useLoaderData();
  const { products = [], shop = '' } = useRouteLoaderData('routes/app') ?? {};
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [selectedInfluencer, setSelectedInfluencer] = useState(null);
  const [selectedProducts, setSelectedProducts]     = useState([]);
  const [expandedProductId, setExpandedProductId]   = useState(null);
  const [activeCollection, setActiveCollection]     = useState('All');

  const allCollections = ['All', ...new Set(products.flatMap(p => p.collections))];
  const filteredProducts = activeCollection === 'All'
    ? products
    : products.filter(p => p.collections.includes(activeCollection));

  const selectVariant = (prod, variant) => {
    setSelectedProducts(prev => {
      const without = prev.filter(p => p.id !== prod.id);
      return [...without, { ...prod, selectedVariant: variant }];
    });
    setExpandedProductId(null);
  };

  const removeProduct = (prodId) =>
    setSelectedProducts(prev => prev.filter(p => p.id !== prodId));

  const totalCost = selectedProducts.reduce((sum, p) => sum + (p.selectedVariant?.price ?? p.price), 0);

  const StepDot = ({ n, label }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: step >= n ? '#000' : '#ddd', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 'bold', flexShrink: 0 }}>{n}</div>
      <span style={{ fontSize: '13px', color: step === n ? '#000' : '#999', fontWeight: step === n ? '600' : '400' }}>{label}</span>
      {n < 3 && <span style={{ color: '#ccc', margin: '0 4px' }}>›</span>}
    </div>
  );

  return (
    <div style={{ maxWidth: '1100px' }}>
      <h2 style={{ marginTop: 0, marginBottom: '24px' }}>New Seeding</h2>

      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '36px' }}>
        <StepDot n={1} label="Influencer" />
        <StepDot n={2} label="Products" />
        <StepDot n={3} label="Details" />
      </div>

      <Form method="post">
        {/* Hidden fields */}
        <input type="hidden" name="shop" value={shop} />
        {selectedInfluencer && <input type="hidden" name="influencerId" value={selectedInfluencer.id} />}
        {selectedProducts.map(p => (
          <span key={p.id}>
            <input type="hidden" name="productIds"    value={p.id} />
            <input type="hidden" name="variantIds"    value={p.selectedVariant?.id ?? p.variantId ?? ''} />
            <input type="hidden" name="productNames"  value={`${p.name}${p.selectedVariant && p.selectedVariant.title !== 'Default Title' ? ` – ${p.selectedVariant.title}` : ''}`} />
            <input type="hidden" name="productPrices" value={p.selectedVariant?.price ?? p.price} />
            <input type="hidden" name="productImages" value={p.image ?? ''} />
          </span>
        ))}

        {/* Step 1 — Influencer */}
        {step === 1 && (
          <div>
            {influencers.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', border: '2px dashed #ddd', color: '#999' }}>
                <p style={{ margin: '0 0 12px' }}>No influencers yet.</p>
                <a href="/app/influencers" style={{ color: '#000', fontWeight: 'bold' }}>Add influencers first →</a>
              </div>
            ) : (
              influencers.map(inf => (
                <button type="button" key={inf.id} onClick={() => setSelectedInfluencer(inf)} style={btn(selectedInfluencer?.id === inf.id)}>
                  <span style={{ fontWeight: '700' }}>{inf.handle}</span>
                  <span style={{ fontSize: '12px', opacity: 0.7, marginLeft: '8px' }}>{inf.name} · {inf.followers?.toLocaleString()} followers · {inf.country}</span>
                </button>
              ))
            )}
            <div style={{ display: 'flex', gap: '8px', marginTop: '24px' }}>
              <button type="button" onClick={() => navigate('/app')} style={{ padding: '10px 20px', border: '1px solid #ccc', background: 'white', cursor: 'pointer' }}>Cancel</button>
              <button type="button" onClick={() => setStep(2)} disabled={!selectedInfluencer}
                style={{ padding: '10px 24px', backgroundColor: selectedInfluencer ? '#000' : '#ccc', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: '600' }}>
                Next →
              </button>
            </div>
          </div>
        )}

        {/* Step 2 — Products */}
        {step === 2 && (
          <div>
            {/* Collection filter tabs */}
            {allCollections.length > 1 && (
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '16px' }}>
                {allCollections.map(col => (
                  <button key={col} type="button" onClick={() => setActiveCollection(col)}
                    style={{ padding: '5px 14px', fontSize: '12px', fontWeight: '600', border: '1px solid #000', cursor: 'pointer', borderRadius: '20px', backgroundColor: activeCollection === col ? '#000' : '#fff', color: activeCollection === col ? '#fff' : '#000' }}>
                    {col}
                  </button>
                ))}
              </div>
            )}

            {/* Product grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '10px', marginBottom: '20px' }}>
              {filteredProducts.map(prod => {
                const selected = selectedProducts.find(p => p.id === prod.id);
                const outOfStock = prod.stock <= 0;
                const isExpanded = expandedProductId === prod.id;
                const isSingleVariant = prod.variants.length === 1 && prod.variants[0].title === 'Default Title';

                return (
                  <div key={prod.id} style={{ display: 'flex', flexDirection: 'column' }}>
                    <button type="button"
                      onClick={() => {
                        if (outOfStock) return;
                        if (isSingleVariant) {
                          selected ? removeProduct(prod.id) : selectVariant(prod, prod.variants[0]);
                        } else {
                          setExpandedProductId(isExpanded ? null : prod.id);
                        }
                      }}
                      style={{ padding: '0', backgroundColor: outOfStock ? '#fafafa' : selected ? '#000' : isExpanded ? '#f0f0f0' : '#fff', color: selected ? '#fff' : '#000', border: outOfStock ? '2px solid #eee' : selected ? '2px solid #000' : isExpanded ? '2px solid #000' : '2px solid #e5e5e5', cursor: outOfStock ? 'not-allowed' : 'pointer', textAlign: 'left', borderRadius: isExpanded ? '6px 6px 0 0' : '6px', overflow: 'hidden', position: 'relative', opacity: outOfStock ? 0.5 : 1 }}>
                      {prod.image ? (
                        <div style={{ width: '100%', aspectRatio: '1 / 1', backgroundColor: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                          <img src={prod.image} alt={prod.name} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', filter: selected ? 'brightness(0.45)' : 'none' }} />
                        </div>
                      ) : (
                        <div style={{ width: '100%', aspectRatio: '1 / 1', backgroundColor: selected ? '#333' : '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px' }}>📦</div>
                      )}
                      {selected && (
                        <div style={{ position: 'absolute', top: '8px', right: '8px', width: '20px', height: '20px', borderRadius: '50%', backgroundColor: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 'bold', color: '#000' }}>✓</div>
                      )}
                      {outOfStock && (
                        <div style={{ position: 'absolute', top: '6px', left: '6px', backgroundColor: '#ff4444', color: '#fff', fontSize: '9px', fontWeight: '800', padding: '2px 5px', borderRadius: '3px', textTransform: 'uppercase' }}>No stock</div>
                      )}
                      <div style={{ padding: '8px 10px' }}>
                        <div style={{ fontWeight: '600', fontSize: '11px', marginBottom: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{prod.name}</div>
                        <div style={{ fontSize: '11px', opacity: 0.6 }}>
                          €{prod.price.toFixed(2)}
                          {selected && prod.selectedVariant?.title !== 'Default Title' && (
                            <span style={{ marginLeft: '4px', fontWeight: '700', opacity: 1 }}>· {prod.selectedVariant.title}</span>
                          )}
                        </div>
                      </div>
                    </button>

                    {/* Variant picker — shown when expanded */}
                    {isExpanded && !isSingleVariant && (
                      <div style={{ border: '2px solid #000', borderTop: 'none', borderRadius: '0 0 6px 6px', padding: '8px', backgroundColor: '#fff', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {prod.variants.map(v => (
                          <button key={v.id} type="button"
                            onClick={() => v.available && selectVariant(prod, v)}
                            style={{ padding: '4px 8px', fontSize: '11px', fontWeight: '700', border: '1px solid #ddd', borderRadius: '3px', cursor: v.available ? 'pointer' : 'not-allowed', backgroundColor: !v.available ? '#f5f5f5' : '#fff', color: !v.available ? '#ccc' : '#000', textDecoration: !v.available ? 'line-through' : 'none' }}>
                            {v.title}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Selected summary */}
            {selectedProducts.length > 0 && (
              <div style={{ marginBottom: '20px', padding: '12px 16px', backgroundColor: '#f5f5f5', borderLeft: '3px solid #000', fontSize: '13px' }}>
                <strong>{selectedProducts.length} product{selectedProducts.length !== 1 ? 's' : ''}</strong> selected · Total: <strong>€{totalCost.toFixed(2)}</strong>
                <div style={{ marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {selectedProducts.map(p => (
                    <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', backgroundColor: '#000', color: '#fff', borderRadius: '3px', fontSize: '11px', fontWeight: '600' }}>
                      {p.name}{p.selectedVariant?.title !== 'Default Title' ? ` – ${p.selectedVariant?.title}` : ''}
                      <button type="button" onClick={() => removeProduct(p.id)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: '0', fontSize: '13px', lineHeight: 1 }}>×</button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="button" onClick={() => setStep(1)} style={{ padding: '10px 20px', border: '1px solid #ccc', background: 'white', cursor: 'pointer' }}>← Back</button>
              <button type="button" onClick={() => setStep(3)} disabled={selectedProducts.length === 0}
                style={{ padding: '10px 24px', backgroundColor: selectedProducts.length > 0 ? '#000' : '#ccc', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: '600' }}>
                Next →
              </button>
            </div>
          </div>
        )}

        {/* Step 3 — Notes */}
        {step === 3 && (
          <div>
            {/* Summary */}
            <div style={{ padding: '16px', backgroundColor: '#f5f5f5', marginBottom: '28px', borderLeft: '3px solid #000' }}>
              <div style={{ fontSize: '13px', fontWeight: '700', marginBottom: '6px' }}>{selectedInfluencer?.handle}</div>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>{selectedProducts.map(p => `${p.name}${p.selectedVariant?.title !== 'Default Title' ? ` (${p.selectedVariant?.title})` : ''}`).join(', ')}</div>
              <div style={{ fontSize: '13px', fontWeight: '700' }}>€{totalCost.toFixed(2)}</div>
            </div>

            {/* What happens next */}
            <div style={{ padding: '16px', border: '1px solid #e0f0ff', backgroundColor: '#f5faff', borderRadius: '6px', marginBottom: '28px' }}>
              <div style={{ fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#0066cc', marginBottom: '10px' }}>What happens when you click Create</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {[
                  '🛒  A Shopify order is created with 100% discount',
                  '🔗  You get a checkout link to share with the influencer',
                  '📦  They fill their own address and check out for free',
                  '✅  Your fulfillment center receives the order automatically',
                ].map(line => (
                  <div key={line} style={{ fontSize: '13px', color: '#333' }}>{line}</div>
                ))}
              </div>
            </div>

            <label style={{ fontSize: '13px', fontWeight: '700' }}>
              Notes / Brief <span style={{ fontWeight: '400', color: '#999' }}>(optional)</span>
              <textarea name="notes" rows={3} placeholder="Campaign notes, content directions, what to post..."
                style={{ ...inputStyle, fontFamily: 'system-ui', resize: 'vertical' }} />
            </label>

            <div style={{ display: 'flex', gap: '8px', marginTop: '28px' }}>
              <button type="button" onClick={() => setStep(2)} style={{ padding: '10px 20px', border: '1px solid #ccc', background: 'white', cursor: 'pointer' }}>← Back</button>
              <button type="submit" style={{ padding: '10px 28px', backgroundColor: '#000', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
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
