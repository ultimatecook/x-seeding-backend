import { useState } from 'react';
import { useLoaderData, useActionData, Form, useNavigation, useRouteLoaderData, useRouteError, Link, redirect } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import prisma from '../db.server';
import { C, btn, input, card, section, fmtDate, fmtNum } from '../theme';

function adminOrderLink(s) {
  if (!s.shop) return null;
  if (s.shopifyOrderName && s.status !== 'Pending') {
    const orderId = s.shopifyOrderName.replace('#', '');
    return `https://${s.shop}/admin/orders/${orderId}`;
  }
  if (s.shopifyDraftOrderId) {
    const draftId = s.shopifyDraftOrderId.split('/').pop();
    return `https://${s.shop}/admin/draft_orders/${draftId}`;
  }
  return null;
}

export async function loader({ params }) {
  const id = parseInt(params.id);
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      products: true,
      seedings: {
        include: { influencer: true, products: true },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  if (!campaign) throw new Response('Not Found', { status: 404 });
  return { campaign };
}

export async function action({ request, params }) {
  const campaignId = parseInt(params.id);
  const formData   = await request.formData();
  const intent     = formData.get('intent');

  if (intent === 'updateStatus') {
    await prisma.seeding.update({
      where: { id: parseInt(formData.get('seedingId')) },
      data: { status: formData.get('status') },
    });
    return null;
  }
  if (intent === 'deleteSeeding') {
    await prisma.seeding.delete({ where: { id: parseInt(formData.get('seedingId')) } });
    return null;
  }
  if (intent === 'deleteCampaign') {
    await prisma.campaign.delete({ where: { id: campaignId } });
    return redirect('/app/campaigns');
  }
  if (intent === 'editProducts') {
    const productIds   = formData.getAll('productId');
    const productNames = formData.getAll('productName');
    const imageUrls    = formData.getAll('imageUrl');
    const maxUnits     = formData.getAll('maxUnits');
    await prisma.campaignProduct.deleteMany({ where: { campaignId } });
    if (productIds.length > 0) {
      await prisma.campaignProduct.createMany({
        data: productIds.map((pid, i) => ({
          campaignId, productId: pid, productName: productNames[i] || '',
          imageUrl: imageUrls[i] || null, maxUnits: maxUnits[i] ? parseInt(maxUnits[i]) : null,
        })),
      });
    }
    return { edited: true };
  }
  return null;
}

const STATUSES = ['Pending', 'Ordered', 'Shipped', 'Delivered', 'Posted'];

export default function CampaignDetail() {
  const { campaign }   = useLoaderData();
  const actionData     = useActionData();
  const navigation     = useNavigation();
  const layoutData     = useRouteLoaderData('routes/app');
  const products       = layoutData?.products ?? [];
  const isSubmitting   = navigation.state === 'submitting';

  const [copiedId, setCopiedId]               = useState(null);
  const [editingProducts, setEditingProducts] = useState(false);
  const [editSearch, setEditSearch]           = useState('');
  const [editSelected, setEditSelected]       = useState([]);
  const [editMaxUnits, setEditMaxUnits]       = useState({});

  if (actionData?.edited && editingProducts) setEditingProducts(false);

  function openEditProducts() {
    const current = campaign.products.map(cp => {
      const full = products.find(p => p.id === cp.productId);
      return full ?? { id: cp.productId, name: cp.productName, image: cp.imageUrl, stock: 1, collections: [], variants: [], price: 0 };
    });
    const units = {};
    campaign.products.forEach(cp => { if (cp.maxUnits) units[cp.productId] = String(cp.maxUnits); });
    setEditSelected(current);
    setEditMaxUnits(units);
    setEditSearch('');
    setEditingProducts(true);
  }

  function toggleEditProduct(p) {
    setEditSelected(prev =>
      prev.find(sp => sp.id === p.id) ? prev.filter(sp => sp.id !== p.id) : [...prev, p]
    );
  }

  const seedings      = campaign.seedings;
  const totalRetail   = seedings.reduce((sum, s) => sum + s.totalCost, 0);
  const totalCostSpend = seedings.reduce((sum, s) =>
    sum + s.products.reduce((ps, p) => ps + (p.cost ?? 0), 0), 0);
  const hasCostData   = seedings.some(s => s.products.some(p => p.cost != null));
  // Budget tracks cost spend; fall back to retail if no cost data
  const budgetBase    = hasCostData ? totalCostSpend : totalRetail;
  const budgetPct     = campaign.budget ? Math.min(100, (budgetBase / campaign.budget) * 100) : null;
  const statusCounts  = STATUSES.reduce((acc, s) => { acc[s] = seedings.filter(sd => sd.status === s).length; return acc; }, {});

  const unitsByProduct = {};
  for (const cp of campaign.products) unitsByProduct[cp.productId] = { ...cp, count: 0 };
  for (const s of seedings) for (const sp of s.products) if (unitsByProduct[sp.productId]) unitsByProduct[sp.productId].count++;

  function handleCopy(id, url) {
    if (url) navigator.clipboard.writeText(url).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  }

  return (
    <div>
      {/* Back */}
      <Link to="/app/campaigns" style={{ fontSize: '13px', color: C.textMuted, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px', marginBottom: '20px' }}>
        ← All Campaigns
      </Link>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '32px' }}>
        <div>
          <h2 style={{ margin: '0 0 6px', fontSize: '24px', color: C.text }}>{campaign.title}</h2>
          <div style={{ fontSize: '13px', color: C.textMuted, display: 'flex', gap: '14px' }}>
            <span>Created {fmtDate(campaign.createdAt, 'medium')}</span>
            {campaign.budget != null && <span style={{ fontWeight: '700', color: C.accent }}>Budget: €{fmtNum(campaign.budget)}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Link to="/app/new" style={{ ...btn.primary, textDecoration: 'none', display: 'inline-block' }}>+ Add Seeding</Link>
          <Form method="post" onSubmit={e => { if (!confirm(`Delete "${campaign.title}"?`)) e.preventDefault(); }}>
            <input type="hidden" name="intent" value="deleteCampaign" />
            <button type="submit" style={{ ...btn.danger }}>Delete Campaign</button>
          </Form>
        </div>
      </div>

      {/* Analytics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '24px' }}>
        {[
          { label: 'Seedings',      value: seedings.length },
          { label: 'Retail Value',  value: `€${totalRetail.toFixed(2)}` },
          hasCostData
            ? { label: 'Cost Spend', value: `€${totalCostSpend.toFixed(2)}` }
            : { label: 'Products',   value: campaign.products.length },
          campaign.budget != null
            ? { label: 'Budget Left', value: `€${Math.max(0, campaign.budget - budgetBase).toFixed(2)}` }
            : { label: 'Posted',      value: statusCounts['Posted'] },
        ].map(stat => (
          <div key={stat.label} style={{ ...card.base, borderLeft: `3px solid ${C.accent}` }}>
            <div style={{ fontSize: '22px', fontWeight: '900', color: C.text, marginBottom: '4px' }}>{stat.value}</div>
            <div style={{ fontSize: '11px', color: C.textSub, textTransform: 'uppercase', letterSpacing: '0.6px' }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Budget bar */}
      {budgetPct !== null && (
        <div style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: C.textSub, marginBottom: '6px' }}>
            <span>Budget used {hasCostData ? '(cost)' : '(retail — set product costs in Shopify for accurate tracking)'}</span>
            <span style={{ fontWeight: '700', color: C.text }}>€{budgetBase.toFixed(2)} / €{fmtNum(campaign.budget)} ({budgetPct.toFixed(0)}%)</span>
          </div>
          <div style={{ height: '6px', backgroundColor: C.surfaceHigh, borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${budgetPct}%`, backgroundColor: budgetPct >= 90 ? C.errorText : budgetPct >= 70 ? '#DD8833' : C.accent, borderRadius: '3px', transition: 'width 0.3s' }} />
          </div>
        </div>
      )}

      {/* Status pills */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '32px', flexWrap: 'wrap' }}>
        {STATUSES.map(s => (
          <div key={s} style={{ padding: '5px 14px', fontSize: '12px', fontWeight: '700', borderRadius: '20px', ...(C.status[s] ?? {}) }}>
            {s}: {statusCounts[s]}
          </div>
        ))}
      </div>

      {/* Products */}
      <div style={{ marginBottom: '36px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <div style={{ ...section.title, marginBottom: 0 }}>Campaign Products ({campaign.products.length})</div>
          {!editingProducts && (
            <button type="button" onClick={openEditProducts} style={{ ...btn.ghost }}>Edit Products</button>
          )}
        </div>

        {!editingProducts && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            {campaign.products.length === 0 && (
              <div style={{ fontSize: '13px', color: C.textMuted }}>No products. Click "Edit Products" to add some.</div>
            )}
            {campaign.products.map(cp => {
              const entry = unitsByProduct[cp.productId];
              const count = entry?.count ?? 0;
              const pct   = cp.maxUnits ? Math.min(100, (count / cp.maxUnits) * 100) : null;
              return (
                <div key={cp.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', ...card.base, minWidth: '200px' }}>
                  {cp.imageUrl && <img src={cp.imageUrl} alt={cp.productName} style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} />}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '2px', color: C.text }}>{cp.productName}</div>
                    <div style={{ fontSize: '11px', color: C.textSub }}>{count} seeded{cp.maxUnits ? ` / ${cp.maxUnits} max` : ''}</div>
                    {pct !== null && (
                      <div style={{ height: '3px', backgroundColor: C.surfaceHigh, borderRadius: '2px', marginTop: '6px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, backgroundColor: pct >= 100 ? C.errorText : C.accent, borderRadius: '2px' }} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Edit products panel */}
        {editingProducts && (
          <Form method="post">
            <input type="hidden" name="intent" value="editProducts" />
            {editSelected.map(p => (
              <span key={p.id}>
                <input type="hidden" name="productId"   value={p.id} />
                <input type="hidden" name="productName" value={p.name} />
                <input type="hidden" name="imageUrl"    value={p.image ?? ''} />
                <input type="hidden" name="maxUnits"    value={editMaxUnits[p.id] ?? ''} />
              </span>
            ))}

            <div style={{ padding: '20px', backgroundColor: C.surface, border: `1px solid ${C.border}`, borderRadius: '8px', marginBottom: '16px' }}>
              <input type="text" placeholder="Search products…" value={editSearch} onChange={e => setEditSearch(e.target.value)}
                style={{ ...input.base, marginBottom: '14px', width: '320px' }} />

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: '8px', marginBottom: '20px' }}>
                {products
                  .filter(p => !editSearch || p.name.toLowerCase().includes(editSearch.toLowerCase()))
                  .map(p => {
                    const selected = !!editSelected.find(sp => sp.id === p.id);
                    return (
                      <div key={p.id} onClick={() => toggleEditProduct(p)}
                        style={{ border: `2px solid ${selected ? C.accent : C.border}`, backgroundColor: selected ? C.accentFaint : C.surfaceHigh, cursor: 'pointer', overflow: 'hidden', position: 'relative', borderRadius: '6px' }}>
                        {p.image ? (
                          <img src={p.image} alt={p.name} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }} />
                        ) : (
                          <div style={{ width: '100%', aspectRatio: '1', backgroundColor: C.overlay, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>📦</div>
                        )}
                        {selected && (
                          <div style={{ position: 'absolute', top: '5px', right: '5px', width: '16px', height: '16px', backgroundColor: C.accent, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', color: '#fff', fontWeight: '900' }}>✓</div>
                        )}
                        <div style={{ padding: '5px 7px', backgroundColor: selected ? C.accentFaint : C.surface }}>
                          <div style={{ fontSize: '10px', fontWeight: '600', color: selected ? C.accent : C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                        </div>
                      </div>
                    );
                  })}
              </div>

              {editSelected.length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.6px', color: C.textSub, marginBottom: '10px' }}>Max Units per Product — optional</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {editSelected.map(p => (
                      <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {p.image && <img src={p.image} alt={p.name} style={{ width: '32px', height: '32px', objectFit: 'cover', borderRadius: '4px' }} />}
                        <span style={{ fontSize: '13px', flex: 1, color: C.text, fontWeight: '500' }}>{p.name}</span>
                        <input type="number" min="1" placeholder="No limit"
                          value={editMaxUnits[p.id] ?? ''}
                          onChange={e => setEditMaxUnits(prev => ({ ...prev, [p.id]: e.target.value }))}
                          style={{ width: '110px', padding: '6px 10px', border: `1px solid ${C.border}`, backgroundColor: C.overlay, color: C.text, fontSize: '13px', borderRadius: '6px' }} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="submit" disabled={isSubmitting} style={{ ...btn.primary }}>
                  {isSubmitting ? 'Saving…' : 'Save Products'}
                </button>
                <button type="button" onClick={() => setEditingProducts(false)} style={{ ...btn.secondary }}>Cancel</button>
              </div>
            </div>
          </Form>
        )}
      </div>

      {/* Seedings */}
      <div style={{ ...section.title }}>Seedings ({seedings.length})</div>

      {seedings.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: C.textMuted, border: `2px dashed ${C.border}`, borderRadius: '8px' }}>
          No seedings yet.{' '}
          <Link to="/app/new" style={{ color: C.accent, fontWeight: '700', textDecoration: 'none' }}>Create the first one →</Link>
        </div>
      ) : (
        <div style={{ ...card.flat, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 2fr 90px 100px 90px 110px', borderBottom: `1px solid ${C.border}`, padding: '10px 16px', fontSize: '10px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.7px', color: C.textSub }}>
            <span>Influencer</span><span>Cost</span><span>Products</span><span>Status</span><span>Checkout</span><span>Order</span><span>Date</span>
          </div>

          {seedings.map(s => {
            const sc   = C.status[s.status] ?? { background: C.surfaceHigh, color: C.textSub };
            const link = adminOrderLink(s);
            return (
              <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 2fr 90px 100px 90px 110px', padding: '12px 16px', alignItems: 'center', fontSize: '13px', borderBottom: `1px solid ${C.borderLight}` }}>
                <div>
                  <div style={{ fontWeight: '700', color: C.accent }}>{s.influencer.handle}</div>
                  <div style={{ fontSize: '11px', color: C.textMuted }}>{s.influencer.name} · {s.influencer.country}</div>
                </div>
                <div style={{ fontWeight: '700', color: C.text }}>€{s.totalCost.toFixed(2)}</div>
                <div style={{ fontSize: '11px', color: C.textSub, lineHeight: '1.4' }}>{s.products.map(p => p.productName).join(', ')}</div>
                <div>
                  <Form method="post">
                    <input type="hidden" name="intent" value="updateStatus" />
                    <input type="hidden" name="seedingId" value={s.id} />
                    <select name="status" defaultValue={s.status} onChange={e => e.target.form.requestSubmit()}
                      style={{ padding: '3px 8px', border: 'none', borderRadius: '12px', fontSize: '11px', fontWeight: '700', cursor: 'pointer', ...sc }}>
                      {STATUSES.map(st => <option key={st} value={st}>{st}</option>)}
                    </select>
                  </Form>
                </div>
                <div>
                  {s.invoiceUrl ? (
                    <button type="button" onClick={() => handleCopy(s.id, s.invoiceUrl)}
                      style={{ ...btn.ghost, fontSize: '11px', padding: '4px 10px', backgroundColor: copiedId === s.id ? C.accentFaint : 'transparent', color: copiedId === s.id ? C.accent : C.textSub, borderColor: copiedId === s.id ? C.accent : C.border }}>
                      {copiedId === s.id ? 'Copied ✓' : 'Copy Link'}
                    </button>
                  ) : <span style={{ color: C.textMuted }}>—</span>}
                </div>
                <div>
                  {link ? (
                    <a href={link} target="_top" rel="noopener noreferrer"
                      style={{ fontSize: '11px', fontWeight: '700', padding: '4px 10px', border: `1px solid ${C.border}`, borderRadius: '5px', color: C.textSub, textDecoration: 'none', display: 'inline-block', backgroundColor: C.surfaceHigh }}>
                      {s.status === 'Pending' ? 'Draft ↗' : 'Order ↗'}
                    </a>
                  ) : <span style={{ color: C.textMuted }}>—</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '11px', color: C.textMuted }}>
                    {fmtDate(s.createdAt, 'short')}
                  </span>
                  <Form method="post" onSubmit={e => { if (!confirm('Delete this seeding?')) e.preventDefault(); }}>
                    <input type="hidden" name="intent" value="deleteSeeding" />
                    <input type="hidden" name="seedingId" value={s.id} />
                    <button type="submit" style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', fontSize: '18px', lineHeight: 1 }}>×</button>
                  </Form>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
