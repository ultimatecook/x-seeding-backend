import { useState } from 'react';
import { useLoaderData, useActionData, Form, useNavigation, useRouteLoaderData, useRouteError, Link, redirect } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import prisma from '../db.server';

export async function loader({ params }) {
  const id = parseInt(params.id);
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      products: true,
      seedings: {
        include: {
          influencer: true,
          products: true,
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  if (!campaign) throw new Response('Not Found', { status: 404 });
  return { campaign };
}

export async function action({ request, params }) {
  const campaignId = parseInt(params.id);
  const formData = await request.formData();
  const intent = formData.get('intent');

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

    // Replace all campaign products
    await prisma.campaignProduct.deleteMany({ where: { campaignId } });
    if (productIds.length > 0) {
      await prisma.campaignProduct.createMany({
        data: productIds.map((pid, i) => ({
          campaignId,
          productId:   pid,
          productName: productNames[i] || '',
          imageUrl:    imageUrls[i] || null,
          maxUnits:    maxUnits[i] ? parseInt(maxUnits[i]) : null,
        })),
      });
    }
    return { edited: true };
  }

  return null;
}

const STATUSES = ['Pending', 'Ordered', 'Shipped', 'Delivered', 'Posted'];

const statusColor = {
  Pending:   { bg: '#fff3cd', color: '#856404' },
  Ordered:   { bg: '#cce5ff', color: '#004085' },
  Shipped:   { bg: '#d4edda', color: '#155724' },
  Delivered: { bg: '#d1ecf1', color: '#0c5460' },
  Posted:    { bg: '#e2d9f3', color: '#4b2a6e' },
};

function copyLink(url) {
  if (url) navigator.clipboard.writeText(url).catch(() => {});
}

export default function CampaignDetail() {
  const { campaign }     = useLoaderData();
  const actionData       = useActionData();
  const navigation       = useNavigation();
  const layoutData       = useRouteLoaderData('routes/app');
  const products         = layoutData?.products ?? [];
  const isSubmitting     = navigation.state === 'submitting';

  const [expandedSeeding, setExpandedSeeding]   = useState(null);
  const [copiedId, setCopiedId]                 = useState(null);
  const [editingProducts, setEditingProducts]   = useState(false);
  const [editSearch, setEditSearch]             = useState('');
  const [editSelected, setEditSelected]         = useState([]);
  const [editMaxUnits, setEditMaxUnits]         = useState({});

  // Close the edit panel after a successful save
  if (actionData?.edited && editingProducts) {
    setEditingProducts(false);
  }

  function openEditProducts() {
    // Pre-populate with current campaign products
    const current = campaign.products.map(cp => {
      const full = products.find(p => p.id === cp.productId);
      return full ?? { id: cp.productId, name: cp.productName, image: cp.imageUrl, stock: 1, collections: [], variants: [], price: 0, variantId: null };
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
      prev.find(sp => sp.id === p.id)
        ? prev.filter(sp => sp.id !== p.id)
        : [...prev, p]
    );
  }

  const seedings = campaign.seedings;

  // ── Analytics ──
  const totalCost = seedings.reduce((sum, s) => sum + s.totalCost, 0);
  const budgetUsedPct = campaign.budget ? Math.min(100, (totalCost / campaign.budget) * 100) : null;

  const statusCounts = STATUSES.reduce((acc, s) => {
    acc[s] = seedings.filter(sd => sd.status === s).length;
    return acc;
  }, {});

  // Units seeded per campaign product
  const unitsByProduct = {};
  for (const cp of campaign.products) {
    unitsByProduct[cp.productId] = { ...cp, count: 0 };
  }
  for (const s of seedings) {
    for (const sp of s.products) {
      if (unitsByProduct[sp.productId]) {
        unitsByProduct[sp.productId].count++;
      }
    }
  }

  function handleCopy(id, url) {
    copyLink(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  }

  return (
    <div>
      {/* Back link */}
      <Link to="/app/campaigns" style={{ fontSize: '13px', color: '#999', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px', marginBottom: '20px' }}>
        ← All Campaigns
      </Link>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '32px' }}>
        <div>
          <h2 style={{ margin: '0 0 6px', fontSize: '24px' }}>{campaign.title}</h2>
          <div style={{ fontSize: '13px', color: '#888' }}>
            Created {new Date(campaign.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            {campaign.budget != null && (
              <span style={{ marginLeft: '14px', fontWeight: '700', color: '#333' }}>Budget: €{campaign.budget.toLocaleString()}</span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Link to={`/app/new`}
            style={{ padding: '8px 16px', backgroundColor: '#000', color: '#fff', textDecoration: 'none', fontWeight: '700', fontSize: '13px', display: 'inline-block' }}>
            + Add Seeding
          </Link>
          <Form method="post" onSubmit={e => { if (!confirm(`Delete "${campaign.title}"?`)) e.preventDefault(); }}>
            <input type="hidden" name="intent" value="deleteCampaign" />
            <button type="submit" style={{ padding: '8px 14px', border: '1px solid #ddd', background: '#fff', cursor: 'pointer', color: '#999', fontSize: '13px' }}>
              Delete Campaign
            </button>
          </Form>
        </div>
      </div>

      {/* ── Analytics ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '32px' }}>
        {[
          { label: 'Total Seedings', value: seedings.length },
          { label: 'Total Cost', value: `€${totalCost.toFixed(2)}` },
          campaign.budget != null
            ? { label: 'Budget Remaining', value: `€${Math.max(0, campaign.budget - totalCost).toFixed(2)}` }
            : { label: 'Products', value: campaign.products.length },
          { label: 'Posted', value: statusCounts['Posted'] },
        ].map(stat => (
          <div key={stat.label} style={{ padding: '16px 20px', border: '1px solid #e5e5e5', backgroundColor: '#fff' }}>
            <div style={{ fontSize: '22px', fontWeight: '800', marginBottom: '4px' }}>{stat.value}</div>
            <div style={{ fontSize: '12px', color: '#999', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Budget bar */}
      {budgetUsedPct !== null && (
        <div style={{ marginBottom: '28px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#666', marginBottom: '6px' }}>
            <span>Budget used</span>
            <span style={{ fontWeight: '700' }}>€{totalCost.toFixed(2)} / €{campaign.budget.toLocaleString()} ({budgetUsedPct.toFixed(0)}%)</span>
          </div>
          <div style={{ height: '8px', backgroundColor: '#f0f0f0', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${budgetUsedPct}%`, backgroundColor: budgetUsedPct >= 90 ? '#e53e3e' : budgetUsedPct >= 70 ? '#dd6b20' : '#000', borderRadius: '4px', transition: 'width 0.3s' }} />
          </div>
        </div>
      )}

      {/* Status breakdown */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '32px', flexWrap: 'wrap' }}>
        {STATUSES.map(s => (
          <div key={s} style={{ padding: '5px 12px', fontSize: '12px', fontWeight: '700', borderRadius: '20px', ...statusColor[s] }}>
            {s}: {statusCounts[s]}
          </div>
        ))}
      </div>

      {/* ── Products section ── */}
      <div style={{ marginBottom: '36px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <div style={{ fontSize: '13px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Campaign Products ({campaign.products.length})
          </div>
          {!editingProducts && (
            <button type="button" onClick={openEditProducts}
              style={{ padding: '6px 14px', fontSize: '12px', fontWeight: '700', border: '1px solid #000', background: '#fff', cursor: 'pointer' }}>
              Edit Products
            </button>
          )}
        </div>

        {/* Current products chips */}
        {!editingProducts && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
            {campaign.products.length === 0 && (
              <div style={{ fontSize: '13px', color: '#bbb' }}>No products. Click "Edit Products" to add some.</div>
            )}
            {campaign.products.map(cp => {
              const entry = unitsByProduct[cp.productId];
              const count = entry?.count ?? 0;
              const pct = cp.maxUnits ? Math.min(100, (count / cp.maxUnits) * 100) : null;
              return (
                <div key={cp.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', border: '1px solid #e5e5e5', backgroundColor: '#fff', minWidth: '200px' }}>
                  {cp.imageUrl && (
                    <img src={cp.imageUrl} alt={cp.productName} style={{ width: '40px', height: '40px', objectFit: 'cover', flexShrink: 0 }} />
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '2px' }}>{cp.productName}</div>
                    <div style={{ fontSize: '11px', color: '#888' }}>
                      {count} seeded{cp.maxUnits ? ` / ${cp.maxUnits} max` : ''}
                    </div>
                    {pct !== null && (
                      <div style={{ height: '4px', backgroundColor: '#f0f0f0', borderRadius: '2px', marginTop: '6px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, backgroundColor: pct >= 100 ? '#e53e3e' : '#000', borderRadius: '2px' }} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Edit products panel ── */}
        {editingProducts && (
          <Form method="post">
            <input type="hidden" name="intent" value="editProducts" />
            {/* Hidden fields for selected products */}
            {editSelected.map(p => (
              <span key={p.id}>
                <input type="hidden" name="productId"   value={p.id} />
                <input type="hidden" name="productName" value={p.name} />
                <input type="hidden" name="imageUrl"    value={p.image ?? ''} />
                <input type="hidden" name="maxUnits"    value={editMaxUnits[p.id] ?? ''} />
              </span>
            ))}

            <div style={{ padding: '20px', backgroundColor: '#f9f9f9', border: '1px solid #e5e5e5', marginBottom: '16px' }}>
              {/* Search */}
              <input
                type="text"
                placeholder="Search products…"
                value={editSearch}
                onChange={e => setEditSearch(e.target.value)}
                style={{ width: '320px', padding: '8px 10px', border: '1px solid #ddd', fontSize: '13px', marginBottom: '14px', boxSizing: 'border-box' }}
              />

              {/* 6-col product grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: '8px', marginBottom: '20px' }}>
                {products
                  .filter(p => !editSearch || p.name.toLowerCase().includes(editSearch.toLowerCase()))
                  .map(p => {
                    const selected = !!editSelected.find(sp => sp.id === p.id);
                    return (
                      <div key={p.id}
                        onClick={() => toggleEditProduct(p)}
                        style={{ border: selected ? '2px solid #000' : '1px solid #ddd', backgroundColor: selected ? '#000' : '#fff', cursor: 'pointer', overflow: 'hidden', position: 'relative' }}>
                        {p.image ? (
                          <img src={p.image} alt={p.name} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block', filter: selected ? 'brightness(0.45)' : 'none' }} />
                        ) : (
                          <div style={{ width: '100%', aspectRatio: '1', backgroundColor: selected ? '#333' : '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px' }}>📦</div>
                        )}
                        {selected && (
                          <div style={{ position: 'absolute', top: '6px', right: '6px', width: '18px', height: '18px', backgroundColor: '#fff', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '900', color: '#000' }}>✓</div>
                        )}
                        <div style={{ padding: '6px 8px', backgroundColor: selected ? '#000' : '#fff' }}>
                          <div style={{ fontSize: '11px', fontWeight: '600', color: selected ? '#fff' : '#000', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                        </div>
                      </div>
                    );
                  })}
              </div>

              {/* Max units per selected product */}
              {editSelected.length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' }}>Max Units per Product — optional</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {editSelected.map(p => (
                      <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {p.image && <img src={p.image} alt={p.name} style={{ width: '32px', height: '32px', objectFit: 'cover', border: '1px solid #eee' }} />}
                        <span style={{ fontSize: '13px', flex: 1, fontWeight: '500' }}>{p.name}</span>
                        <input type="number" min="1" placeholder="No limit"
                          value={editMaxUnits[p.id] ?? ''}
                          onChange={e => setEditMaxUnits(prev => ({ ...prev, [p.id]: e.target.value }))}
                          style={{ width: '110px', padding: '6px 10px', border: '1px solid #ddd', fontSize: '13px' }} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="submit" disabled={isSubmitting}
                  style={{ padding: '9px 22px', backgroundColor: '#000', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: '700', fontSize: '13px' }}>
                  {isSubmitting ? 'Saving…' : 'Save Products'}
                </button>
                <button type="button" onClick={() => setEditingProducts(false)}
                  style={{ padding: '9px 18px', border: '1px solid #ccc', background: '#fff', cursor: 'pointer', fontSize: '13px' }}>
                  Cancel
                </button>
              </div>
            </div>
          </Form>
        )}
      </div>

      {/* ── Seedings table ── */}
      <div style={{ fontSize: '13px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '14px' }}>
        Seedings ({seedings.length})
      </div>

      {seedings.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#999', border: '2px dashed #ddd' }}>
          No seedings yet.{' '}
          <Link to="/app/new" style={{ color: '#000', fontWeight: '700' }}>Create the first one →</Link>
        </div>
      ) : (
        <div style={{ border: '1px solid #e5e5e5', backgroundColor: '#fff' }}>
          {/* Table header */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 2fr 80px 120px 130px', gap: '0', borderBottom: '2px solid #000', padding: '10px 16px', fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#666' }}>
            <span>Influencer</span>
            <span>Cost</span>
            <span>Products</span>
            <span>Status</span>
            <span>Checkout Link</span>
            <span>Date</span>
          </div>

          {seedings.map(s => {
            const isExpanded = expandedSeeding === s.id;
            const sc = statusColor[s.status] ?? { bg: '#f5f5f5', color: '#333' };
            return (
              <div key={s.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 2fr 80px 120px 130px', gap: '0', padding: '12px 16px', alignItems: 'center', fontSize: '13px' }}>
                  {/* Influencer */}
                  <div>
                    <div style={{ fontWeight: '700' }}>{s.influencer.handle}</div>
                    <div style={{ fontSize: '11px', color: '#999' }}>{s.influencer.name} · {s.influencer.country}</div>
                  </div>

                  {/* Cost */}
                  <div style={{ fontWeight: '600' }}>€{s.totalCost.toFixed(2)}</div>

                  {/* Products */}
                  <div style={{ fontSize: '11px', color: '#555', lineHeight: '1.4' }}>
                    {s.products.map(p => p.productName).join(', ')}
                  </div>

                  {/* Status dropdown */}
                  <div>
                    <Form method="post">
                      <input type="hidden" name="intent" value="updateStatus" />
                      <input type="hidden" name="seedingId" value={s.id} />
                      <select name="status" defaultValue={s.status}
                        onChange={e => e.target.form.requestSubmit()}
                        style={{ padding: '3px 6px', fontSize: '11px', fontWeight: '700', border: 'none', borderRadius: '10px', cursor: 'pointer', backgroundColor: sc.bg, color: sc.color }}>
                        {STATUSES.map(st => <option key={st} value={st}>{st}</option>)}
                      </select>
                    </Form>
                  </div>

                  {/* Copy link */}
                  <div>
                    {s.invoiceUrl ? (
                      <button type="button"
                        onClick={() => handleCopy(s.id, s.invoiceUrl)}
                        style={{ fontSize: '11px', fontWeight: '700', padding: '4px 8px', border: '1px solid #000', background: copiedId === s.id ? '#000' : '#fff', color: copiedId === s.id ? '#fff' : '#000', cursor: 'pointer' }}>
                        {copiedId === s.id ? 'Copied ✓' : 'Copy Link'}
                      </button>
                    ) : (
                      <span style={{ fontSize: '11px', color: '#ccc' }}>—</span>
                    )}
                  </div>

                  {/* Date + delete */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '11px', color: '#999' }}>
                      {new Date(s.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </span>
                    <Form method="post" onSubmit={e => { if (!confirm('Delete this seeding?')) e.preventDefault(); }}>
                      <input type="hidden" name="intent" value="deleteSeeding" />
                      <input type="hidden" name="seedingId" value={s.id} />
                      <button type="submit" style={{ background: 'none', border: 'none', color: '#ccc', cursor: 'pointer', fontSize: '18px', lineHeight: 1, padding: '0 4px' }}>×</button>
                    </Form>
                  </div>
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
