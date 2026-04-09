import { useState } from 'react';
import { useLoaderData, useActionData, Form, useNavigation, useRouteLoaderData, useRouteError, Link } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import prisma from '../db.server';
import { C, btn, input, card, label as lbl, fmtDate, fmtNum } from '../theme';
import { requireRole } from '../utils/authz.server';

export async function loader({ request }) {
  const ctx = await requireRole(request, 'Viewer');
  const campaigns = await prisma.campaign.findMany({
    where: { shop: ctx.shop },
    orderBy: { createdAt: 'desc' },
    include: { products: true, seedings: true },
  });
  return { campaigns };
}

export async function action({ request }) {
  const ctx = await requireRole(request, 'Editor');
  const formData = await request.formData();
  const intent = formData.get('intent');

  if (intent === 'create') {
    const title      = formData.get('title');
    const budget     = formData.get('budget') ? parseFloat(formData.get('budget')) : null;
    const productIds = formData.getAll('productId');
    const productNames = formData.getAll('productName');
    const imageUrls  = formData.getAll('imageUrl');
    const maxUnits   = formData.getAll('maxUnits');
    const shop       = ctx.shop;

    await prisma.campaign.create({
      data: {
        shop, title, budget,
        products: {
          create: productIds.map((pid, i) => ({
            productId: pid, productName: productNames[i] || '',
            imageUrl: imageUrls[i] || null, maxUnits: maxUnits[i] ? parseInt(maxUnits[i]) : null,
          })),
        },
      },
    });
    return { created: true };
  }

  if (intent === 'delete') {
    await prisma.campaign.delete({ where: { id: parseInt(formData.get('id')) } });
    return null;
  }

  return null;
}

export default function Campaigns() {
  const { campaigns }    = useLoaderData();
  const actionData       = useActionData();
  const navigation       = useNavigation();
  const layoutData       = useRouteLoaderData('routes/app');
  const products         = layoutData?.products ?? [];
  const shop             = layoutData?.shop ?? '';

  const [showForm, setShowForm]           = useState(false);
  const [search, setSearch]               = useState('');
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [maxUnitsMap, setMaxUnitsMap]     = useState({});
  const isSubmitting = navigation.state === 'submitting';

  const filteredProducts = products.filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase())
  );

  function toggleProduct(p) {
    setSelectedProducts(prev =>
      prev.find(sp => sp.id === p.id) ? prev.filter(sp => sp.id !== p.id) : [...prev, p]
    );
  }

  function handleCreated() {
    setShowForm(false);
    setSelectedProducts([]);
    setMaxUnitsMap({});
    setSearch('');
  }

  if (actionData?.created && showForm) handleCreated();

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px' }}>
        <h2 style={{ margin: 0, color: C.text }}>
          Campaigns <span style={{ fontSize: '14px', fontWeight: '400', color: C.textMuted }}>({campaigns.length})</span>
        </h2>
        <button onClick={() => setShowForm(v => !v)}
          style={{ ...btn.primary, backgroundColor: showForm ? 'transparent' : C.accent, color: showForm ? C.textSub : '#fff', border: showForm ? `1px solid ${C.border}` : 'none' }}>
          {showForm ? 'Cancel' : '+ New Campaign'}
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <Form method="post" onSubmit={() => { if (!isSubmitting) handleCreated(); }}
          style={{ padding: '24px', backgroundColor: C.surface, border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.accent}`, borderRadius: '8px', marginBottom: '36px' }}>
          <input type="hidden" name="intent" value="create" />
          <input type="hidden" name="shop" value={shop} />
          {selectedProducts.map(p => (
            <span key={p.id}>
              <input type="hidden" name="productId"   value={p.id} />
              <input type="hidden" name="productName" value={p.name} />
              <input type="hidden" name="imageUrl"    value={p.image ?? ''} />
              <input type="hidden" name="maxUnits"    value={maxUnitsMap[p.id] ?? ''} />
            </span>
          ))}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
            <label style={{ ...lbl.base }}>
              Campaign Title *
              <input name="title" required placeholder="Summer Drop 2025"
                style={{ ...input.base, display: 'block', marginTop: '6px' }} />
            </label>
            <label style={{ ...lbl.base }}>
              Total Budget (€) — optional
              <input name="budget" type="number" step="0.01" placeholder="e.g. 2000"
                style={{ ...input.base, display: 'block', marginTop: '6px' }} />
            </label>
          </div>

          {/* Product search */}
          <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.6px', color: C.textSub, marginBottom: '10px' }}>
            Select Products
            {selectedProducts.length > 0 && <span style={{ marginLeft: '8px', fontWeight: '400', textTransform: 'none', color: C.accent }}>{selectedProducts.length} selected</span>}
          </div>
          <input type="text" placeholder="Search products…" value={search} onChange={e => setSearch(e.target.value)}
            style={{ ...input.base, marginBottom: '12px', width: '320px' }} />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: '8px', marginBottom: '20px' }}>
            {filteredProducts.map(p => {
              const selected = !!selectedProducts.find(sp => sp.id === p.id);
              return (
                <div key={p.id} onClick={() => toggleProduct(p)}
                  style={{ border: `2px solid ${selected ? C.accent : C.border}`, backgroundColor: selected ? C.accentFaint : C.surfaceHigh, cursor: 'pointer', overflow: 'hidden', position: 'relative', borderRadius: '6px' }}>
                  {p.image ? (
                    <img src={p.image} alt={p.name} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }} />
                  ) : (
                    <div style={{ width: '100%', aspectRatio: '1', backgroundColor: C.overlay, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>📦</div>
                  )}
                  {selected && (
                    <div style={{ position: 'absolute', top: '5px', right: '5px', width: '16px', height: '16px', backgroundColor: C.accent, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', fontWeight: '900', color: '#fff' }}>✓</div>
                  )}
                  <div style={{ padding: '5px 7px', backgroundColor: selected ? C.accentFaint : C.surface }}>
                    <div style={{ fontSize: '10px', fontWeight: '600', color: selected ? C.accent : C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Max units */}
          {selectedProducts.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.6px', color: C.textSub, marginBottom: '10px' }}>Max Units per Product — optional</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {selectedProducts.map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {p.image && <img src={p.image} alt={p.name} style={{ width: '32px', height: '32px', objectFit: 'cover', borderRadius: '4px' }} />}
                    <span style={{ fontSize: '13px', flex: 1, color: C.text, fontWeight: '500' }}>{p.name}</span>
                    <input type="number" min="1" placeholder="No limit"
                      value={maxUnitsMap[p.id] ?? ''}
                      onChange={e => setMaxUnitsMap(prev => ({ ...prev, [p.id]: e.target.value }))}
                      style={{ width: '110px', padding: '7px 10px', border: `1px solid ${C.border}`, backgroundColor: C.overlay, color: C.text, fontSize: '13px', borderRadius: '6px' }} />
                  </div>
                ))}
              </div>
            </div>
          )}

          <button type="submit" disabled={isSubmitting || selectedProducts.length === 0}
            style={{ ...btn.primary, opacity: selectedProducts.length === 0 ? 0.4 : 1, cursor: selectedProducts.length === 0 ? 'not-allowed' : 'pointer', fontSize: '14px', padding: '11px 28px' }}>
            {isSubmitting ? 'Creating…' : 'Create Campaign'}
          </button>
        </Form>
      )}

      {/* Campaign list */}
      {campaigns.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: C.textMuted, border: `2px dashed ${C.border}`, borderRadius: '8px' }}>
          <p style={{ margin: '0 0 8px', fontSize: '16px', color: C.textSub }}>No campaigns yet.</p>
          <p style={{ margin: 0, fontSize: '13px' }}>Create one to start grouping products for seeding.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {campaigns.map(c => (
            <div key={c.id} style={{ ...card.base, display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <Link to={`/app/campaigns/${c.id}`} style={{ textDecoration: 'none', color: 'inherit', flex: 1 }}>
                  <div style={{ fontSize: '15px', fontWeight: '800', color: C.text, marginBottom: '4px' }}>
                    {c.title} <span style={{ fontSize: '13px', fontWeight: '400', color: C.textMuted }}>→</span>
                  </div>
                  <div style={{ fontSize: '12px', color: C.textMuted, display: 'flex', gap: '12px' }}>
                    <span>{fmtDate(c.createdAt, 'medium')}</span>
                    {c.budget != null && <span style={{ color: C.accent, fontWeight: '700' }}>€{fmtNum(c.budget)}</span>}
                    <span>{c.seedings.length} seeding{c.seedings.length !== 1 ? 's' : ''}</span>
                    <span>{c.products.length} product{c.products.length !== 1 ? 's' : ''}</span>
                  </div>
                </Link>
                <Form method="post" onSubmit={e => { if (!confirm(`Delete "${c.title}"?`)) e.preventDefault(); }}>
                  <input type="hidden" name="intent" value="delete" />
                  <input type="hidden" name="id" value={c.id} />
                  <button type="submit" style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', fontSize: '20px', lineHeight: 1 }}>×</button>
                </Form>
              </div>

              {c.products.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {c.products.map(cp => (
                    <div key={cp.id} style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '5px 10px 5px 6px', border: `1px solid ${C.border}`, backgroundColor: C.surfaceHigh, borderRadius: '6px' }}>
                      {cp.imageUrl && <img src={cp.imageUrl} alt={cp.productName} style={{ width: '24px', height: '24px', objectFit: 'cover', borderRadius: '3px' }} />}
                      <span style={{ fontSize: '12px', fontWeight: '600', color: C.text }}>{cp.productName}</span>
                      {cp.maxUnits && <span style={{ fontSize: '11px', color: C.textMuted }}>max {cp.maxUnits}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
