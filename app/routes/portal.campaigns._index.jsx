import { useState } from 'react';
import { useLoaderData, Link, Form, redirect } from 'react-router';
import prisma from '../db.server';
import { requirePortalUser } from '../utils/portal-auth.server';
import { can, requirePermission } from '../utils/portal-permissions';
import { audit } from '../utils/audit.server.js';
import { fmtDate, fmtNum } from '../theme';
import { D, Pbtn as btn, Pinput as input, FlagImg } from '../utils/portal-theme';

// ── Loader ────────────────────────────────────────────────────────────────────
export async function loader({ request }) {
  const { shop, portalUser } = await requirePortalUser(request);
  requirePermission(portalUser.role, 'viewCampaigns');

  const campaigns = await prisma.campaign.findMany({
    where:   { shop },
    include: { products: true, _count: { select: { seedings: true } } },
    orderBy: { createdAt: 'desc' },
  });

  // Fetch Shopify products for the product picker (same offline token approach)
  let shopifyProducts = [];
  try {
    let session = await prisma.session.findFirst({ where: { shop, isOnline: false, expires: null } });
    if (!session) session = await prisma.session.findFirst({ where: { shop, isOnline: false }, orderBy: { expires: 'desc' } });
    if (!session) session = await prisma.session.findFirst({ where: { shop }, orderBy: { expires: 'desc' } });

    if (session?.accessToken) {
      const res  = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': session.accessToken },
        body: JSON.stringify({ query: `query {
          products(first: 100, sortKey: TITLE) { edges { node {
            id title featuredImage { url }
            variants(first: 1) { edges { node { price } } }
          } } }
        }` }),
      });
      const body = await res.json();
      shopifyProducts = (body?.data?.products?.edges ?? []).map(e => ({
        id:    e.node.id,
        name:  e.node.title,
        image: e.node.featuredImage?.url ?? null,
        price: parseFloat(e.node.variants.edges[0]?.node?.price || 0),
      }));
    }
  } catch (e) {
    console.error('Portal campaigns: failed to fetch products', e.message);
  }

  return { campaigns, shopifyProducts, canCreate: can.createCampaign(portalUser.role) };
}

// ── Action ────────────────────────────────────────────────────────────────────
export async function action({ request }) {
  const { shop, portalUser } = await requirePortalUser(request);
  requirePermission(portalUser.role, 'createCampaign');

  const formData      = await request.formData();
  const title         = String(formData.get('title') || '').trim();
  const budgetRaw     = formData.get('budget');
  const budget        = budgetRaw ? parseFloat(budgetRaw) : null;
  const productIds    = formData.getAll('productIds');
  const productNames  = formData.getAll('productNames');
  const productImages = formData.getAll('productImages');

  if (!title) return { error: 'Campaign title is required.' };

  const campaign = await prisma.campaign.create({
    data: {
      shop, title, budget,
      products: {
        create: productIds.map((productId, i) => ({
          productId,
          productName: productNames[i] || '',
          imageUrl:    productImages[i] || null,
        })),
      },
    },
  });

  await audit({ shop, portalUser, action: 'created_campaign', entityType: 'campaign', entityId: campaign.id, detail: `Created campaign "${title}" with ${productIds.length} product(s)` });
  throw redirect(`/portal/campaigns/${campaign.id}`);
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function PortalCampaigns() {
  const { campaigns, shopifyProducts, canCreate } = useLoaderData();
  const [showForm,      setShowForm]      = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [selectedProds, setSelectedProds] = useState([]);

  const filteredProducts = shopifyProducts.filter(p =>
    !productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase())
  );

  function toggleProduct(prod) {
    setSelectedProds(prev =>
      prev.find(p => p.id === prod.id)
        ? prev.filter(p => p.id !== prod.id)
        : [...prev, prod]
    );
  }

  function handleCancel() {
    setShowForm(false);
    setSelectedProds([]);
    setProductSearch('');
  }

  return (
    <div style={{ display: 'grid', gap: '20px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: D.text, letterSpacing: '-0.3px' }}>
            Campaigns {campaigns.length > 0 && <span style={{ fontSize: '14px', fontWeight: '600', color: D.textMuted }}>({campaigns.length})</span>}
          </h2>
        </div>
        {canCreate && (
          <button type="button" onClick={() => showForm ? handleCancel() : setShowForm(true)}
            style={{ ...btn.primary, padding: '9px 18px', fontSize: '13px' }}>
            {showForm ? 'Cancel' : '+ New Campaign'}
          </button>
        )}
      </div>

      {/* ── Create form ────────────────────────────────────────── */}
      {showForm && canCreate && (
        <div style={{ backgroundColor: D.surface, border: `1px solid ${D.accent}`, borderRadius: '12px', padding: '24px', boxShadow: D.shadow }}>
          <Form method="post" onSubmit={handleCancel}>
            {/* Hidden fields for selected products */}
            {selectedProds.map(p => (
              <span key={p.id}>
                <input type="hidden" name="productIds"    value={p.id} />
                <input type="hidden" name="productNames"  value={p.name} />
                <input type="hidden" name="productImages" value={p.image ?? ''} />
              </span>
            ))}

            {/* Title + Budget */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
              <div>
                <label style={{ fontSize: '11px', fontWeight: '700', color: D.textMuted, textTransform: 'uppercase', letterSpacing: '0.6px', display: 'block', marginBottom: '6px' }}>
                  Campaign Title *
                </label>
                <input name="title" required placeholder="e.g. Summer Drop 2025" autoFocus
                  style={{ ...input.base, width: '100%', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: '11px', fontWeight: '700', color: D.textMuted, textTransform: 'uppercase', letterSpacing: '0.6px', display: 'block', marginBottom: '6px' }}>
                  Total Budget (€) — Optional
                </label>
                <input name="budget" type="number" min="0" step="0.01" placeholder="e.g. 2000"
                  style={{ ...input.base, width: '100%', boxSizing: 'border-box' }} />
              </div>
            </div>

            {/* Product picker */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ fontSize: '11px', fontWeight: '700', color: D.textMuted, textTransform: 'uppercase', letterSpacing: '0.6px', display: 'block', marginBottom: '8px' }}>
                Select Products {selectedProds.length > 0 && <span style={{ color: D.accent }}>({selectedProds.length} selected)</span>}
              </label>
              <input
                type="text" placeholder="Search products…" value={productSearch}
                onChange={e => setProductSearch(e.target.value)}
                style={{ ...input.base, width: '100%', boxSizing: 'border-box', marginBottom: '10px' }}
              />
              {shopifyProducts.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: D.textMuted, fontSize: '13px', border: `1px dashed ${D.border}`, borderRadius: '8px' }}>
                  No products loaded — open the app in Shopify admin once to authorize.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '8px', maxHeight: '320px', overflowY: 'auto', padding: '2px' }}>
                  {filteredProducts.map(prod => {
                    const selected = selectedProds.some(p => p.id === prod.id);
                    return (
                      <div key={prod.id}
                        onClick={() => toggleProduct(prod)}
                        style={{
                          border: `2px solid ${selected ? D.accent : D.border}`,
                          borderRadius: '8px', overflow: 'hidden', cursor: 'pointer',
                          backgroundColor: selected ? D.accentFaint : D.surface,
                          transition: 'all 0.12s', position: 'relative',
                        }}>
                        {selected && (
                          <div style={{ position: 'absolute', top: '6px', right: '6px', width: '18px', height: '18px', borderRadius: '50%', backgroundColor: D.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '900', color: '#000', zIndex: 1 }}>
                            ✓
                          </div>
                        )}
                        {prod.image
                          ? <img src={prod.image} alt={prod.name} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }} />
                          : <div style={{ width: '100%', aspectRatio: '1', backgroundColor: D.surfaceHigh, display: 'flex', alignItems: 'center', justifyContent: 'center', color: D.textMuted, fontSize: '24px' }}>📦</div>
                        }
                        <div style={{ padding: '6px 8px' }}>
                          <div style={{ fontSize: '11px', fontWeight: '700', color: D.text, lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                            {prod.name}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Submit */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', paddingTop: '4px', borderTop: `1px solid ${D.border}` }}>
              <button type="button" onClick={handleCancel}
                style={{ padding: '9px 18px', borderRadius: '8px', border: `1px solid ${D.border}`, backgroundColor: 'transparent', color: D.textSub, cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>
                Cancel
              </button>
              <button type="submit"
                style={{ ...btn.primary, padding: '9px 24px', fontSize: '13px' }}>
                Create Campaign
              </button>
            </div>
          </Form>
        </div>
      )}

      {/* ── Campaign list ──────────────────────────────────────── */}
      {campaigns.length === 0 && !showForm ? (
        <div style={{ textAlign: 'center', padding: '60px', border: `2px dashed ${D.border}`, borderRadius: '12px', color: D.textMuted }}>
          <p style={{ margin: 0, fontSize: '15px', color: D.textSub }}>No campaigns yet.</p>
          {canCreate && <p style={{ margin: '6px 0 0', fontSize: '13px' }}>Click "+ New Campaign" to create one.</p>}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '12px' }}>
          {campaigns.map(c => (
            <Link key={c.id} to={`/portal/campaigns/${c.id}`} style={{ textDecoration: 'none' }}>
              <div style={{
                backgroundColor: D.surface, border: `1px solid ${D.border}`,
                borderRadius: '12px', padding: '18px 20px', boxShadow: D.shadow,
                display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: '16px',
                transition: 'border-color 0.15s', cursor: 'pointer',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = D.accent; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = D.border; }}
              >
                <div>
                  <div style={{ fontSize: '15px', fontWeight: '800', color: D.text, marginBottom: '5px' }}>{c.title}</div>
                  <div style={{ fontSize: '12px', color: D.textSub, display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    <span>{c._count.seedings} seeding{c._count.seedings !== 1 ? 's' : ''}</span>
                    <span>{c.products.length} product{c.products.length !== 1 ? 's' : ''}</span>
                    {c.budget != null && <span style={{ color: D.accent, fontWeight: '700' }}>€{fmtNum(c.budget)} budget</span>}
                    <span>{fmtDate(c.createdAt, 'medium')}</span>
                  </div>
                  {c.products.length > 0 && (
                    <div style={{ marginTop: '10px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {c.products.map(p => (
                        <div key={p.id} style={{
                          display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: D.textSub,
                          backgroundColor: D.bg, border: `1px solid ${D.borderLight}`, borderRadius: '6px', padding: '3px 8px',
                        }}>
                          {p.imageUrl && <img src={p.imageUrl} alt={p.productName} style={{ width: '16px', height: '16px', objectFit: 'cover', borderRadius: '3px' }} />}
                          {p.productName}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <span style={{ fontSize: '13px', color: D.accent, fontWeight: '700' }}>View →</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
