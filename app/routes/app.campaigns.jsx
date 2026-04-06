import { useState } from 'react';
import { useLoaderData, useActionData, Form, useNavigation, useRouteLoaderData, useRouteError, Link } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import prisma from '../db.server';

export async function loader({ request }) {
  const campaigns = await prisma.campaign.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      products: true,
      seedings: true,
    },
  });
  return { campaigns };
}

export async function action({ request }) {
  const formData = await request.formData();
  const intent = formData.get('intent');

  if (intent === 'create') {
    const title = formData.get('title');
    const budget = formData.get('budget') ? parseFloat(formData.get('budget')) : null;

    const productIds   = formData.getAll('productId');
    const productNames = formData.getAll('productName');
    const imageUrls    = formData.getAll('imageUrl');
    const maxUnits     = formData.getAll('maxUnits');

    const shop = formData.get('shop') || '';

    await prisma.campaign.create({
      data: {
        shop,
        title,
        budget,
        products: {
          create: productIds.map((pid, i) => ({
            productId:   pid,
            productName: productNames[i] || '',
            imageUrl:    imageUrls[i] || null,
            maxUnits:    maxUnits[i] ? parseInt(maxUnits[i]) : null,
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

const inputStyle = {
  padding: '9px 10px',
  border: '1px solid #ddd',
  fontSize: '13px',
  width: '100%',
  boxSizing: 'border-box',
};

export default function Campaigns() {
  const { campaigns }       = useLoaderData();
  const actionData          = useActionData();
  const navigation          = useNavigation();
  const layoutData          = useRouteLoaderData('routes/app');
  const products            = layoutData?.products ?? [];
  const shop                = layoutData?.shop ?? '';

  const [showForm, setShowForm]           = useState(false);
  const [search, setSearch]               = useState('');
  const [selectedProducts, setSelectedProducts] = useState([]);
  // maxUnits per productId
  const [maxUnitsMap, setMaxUnitsMap]     = useState({});
  const isSubmitting = navigation.state === 'submitting';

  const filteredProducts = products.filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase())
  );

  function toggleProduct(p) {
    setSelectedProducts(prev =>
      prev.find(sp => sp.id === p.id)
        ? prev.filter(sp => sp.id !== p.id)
        : [...prev, p]
    );
  }

  function handleCreated() {
    setShowForm(false);
    setSelectedProducts([]);
    setMaxUnitsMap({});
    setSearch('');
  }

  // Close form after successful create
  if (actionData?.created && showForm) {
    handleCreated();
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px' }}>
        <h2 style={{ margin: 0 }}>
          Campaigns{' '}
          <span style={{ fontSize: '14px', fontWeight: '400', color: '#999' }}>({campaigns.length})</span>
        </h2>
        <button
          onClick={() => { setShowForm(v => !v); }}
          style={{
            padding: '8px 16px',
            backgroundColor: showForm ? '#fff' : '#000',
            color: showForm ? '#000' : '#fff',
            border: '1px solid #000',
            cursor: 'pointer',
            fontWeight: '600',
            fontSize: '13px',
          }}
        >
          {showForm ? 'Cancel' : '+ New Campaign'}
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <Form method="post" onSubmit={() => { if (!isSubmitting) handleCreated(); }}
          style={{ padding: '28px', backgroundColor: '#f5f5f5', marginBottom: '36px', borderLeft: '3px solid #000' }}>
          <input type="hidden" name="intent" value="create" />
          <input type="hidden" name="shop" value={shop} />

          {/* Hidden fields for selected products */}
          {selectedProducts.map(p => (
            <span key={p.id}>
              <input type="hidden" name="productId"   value={p.id} />
              <input type="hidden" name="productName" value={p.name} />
              <input type="hidden" name="imageUrl"    value={p.image ?? ''} />
              <input type="hidden" name="maxUnits"    value={maxUnitsMap[p.id] ?? ''} />
            </span>
          ))}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
            <label style={{ fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Campaign Title *
              <input name="title" required placeholder="Summer Drop 2025"
                style={{ ...inputStyle, display: 'block', marginTop: '4px' }} />
            </label>
            <label style={{ fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Total Budget (€) — optional
              <input name="budget" type="number" step="0.01" placeholder="e.g. 2000"
                style={{ ...inputStyle, display: 'block', marginTop: '4px' }} />
            </label>
          </div>

          {/* Product picker */}
          <div style={{ marginBottom: '8px', fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Select Products
            {selectedProducts.length > 0 && (
              <span style={{ marginLeft: '8px', fontWeight: '400', textTransform: 'none', color: '#666' }}>
                {selectedProducts.length} selected
              </span>
            )}
          </div>

          <input
            type="text"
            placeholder="Search products…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ ...inputStyle, marginBottom: '12px', width: '320px', boxSizing: 'border-box' }}
          />

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
            gap: '10px',
            marginBottom: '24px',
          }}>
            {filteredProducts.map(p => {
              const selected = !!selectedProducts.find(sp => sp.id === p.id);
              return (
                <div key={p.id}
                  onClick={() => toggleProduct(p)}
                  style={{
                    border: selected ? '2px solid #000' : '1px solid #ddd',
                    backgroundColor: selected ? '#000' : '#fff',
                    cursor: 'pointer',
                    padding: '0',
                    position: 'relative',
                    overflow: 'hidden',
                  }}>
                  {p.image ? (
                    <img src={p.image} alt={p.name}
                      style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }} />
                  ) : (
                    <div style={{ width: '100%', aspectRatio: '1', backgroundColor: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontSize: '11px', color: '#bbb' }}>No img</span>
                    </div>
                  )}
                  <div style={{ padding: '6px 8px', backgroundColor: selected ? '#000' : '#fff' }}>
                    <div style={{ fontSize: '11px', fontWeight: '600', lineHeight: '1.3', color: selected ? '#fff' : '#000', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.name}
                    </div>
                  </div>
                  {selected && (
                    <div style={{ position: 'absolute', top: '6px', right: '6px', width: '18px', height: '18px', backgroundColor: '#fff', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '900' }}>
                      ✓
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Per-product max units (only for selected products) */}
          {selectedProducts.length > 0 && (
            <div style={{ marginBottom: '24px' }}>
              <div style={{ fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' }}>
                Max Units per Product — optional
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {selectedProducts.map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {p.image && (
                      <img src={p.image} alt={p.name}
                        style={{ width: '36px', height: '36px', objectFit: 'cover', border: '1px solid #eee' }} />
                    )}
                    <span style={{ fontSize: '13px', flex: 1, fontWeight: '500' }}>{p.name}</span>
                    <input
                      type="number"
                      min="1"
                      placeholder="No limit"
                      value={maxUnitsMap[p.id] ?? ''}
                      onChange={e => setMaxUnitsMap(prev => ({ ...prev, [p.id]: e.target.value }))}
                      style={{ width: '110px', padding: '7px 10px', border: '1px solid #ddd', fontSize: '13px' }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <button type="submit" disabled={isSubmitting || selectedProducts.length === 0}
            style={{
              padding: '11px 28px',
              backgroundColor: selectedProducts.length === 0 ? '#ccc' : '#000',
              color: '#fff',
              border: 'none',
              cursor: selectedProducts.length === 0 ? 'not-allowed' : 'pointer',
              fontWeight: '700',
              fontSize: '14px',
            }}>
            {isSubmitting ? 'Creating…' : 'Create Campaign'}
          </button>
        </Form>
      )}

      {/* Campaign list */}
      {campaigns.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#999', border: '2px dashed #ddd' }}>
          <p style={{ margin: '0 0 8px', fontSize: '16px' }}>No campaigns yet.</p>
          <p style={{ margin: 0, fontSize: '13px' }}>Create one to start grouping products for seeding.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {campaigns.map(c => (
            <div key={c.id} style={{ border: '1px solid #e5e5e5', backgroundColor: '#fff', padding: '20px 24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
                <Link to={`/app/campaigns/${c.id}`} style={{ textDecoration: 'none', color: 'inherit', flex: 1 }}>
                  <div style={{ fontSize: '16px', fontWeight: '800', marginBottom: '4px' }}>{c.title} <span style={{ fontSize: '13px', fontWeight: '400', color: '#bbb' }}>→</span></div>
                  <div style={{ fontSize: '12px', color: '#999' }}>
                    {new Date(c.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {c.budget != null && (
                      <span style={{ marginLeft: '12px', color: '#555', fontWeight: '600' }}>
                        Budget: €{c.budget.toLocaleString()}
                      </span>
                    )}
                    <span style={{ marginLeft: '12px' }}>{c.seedings.length} seeding{c.seedings.length !== 1 ? 's' : ''}</span>
                  </div>
                </Link>
                <Form method="post"
                  onSubmit={e => { if (!confirm(`Delete "${c.title}"?`)) e.preventDefault(); }}>
                  <input type="hidden" name="intent" value="delete" />
                  <input type="hidden" name="id" value={c.id} />
                  <button type="submit"
                    style={{ background: 'none', border: 'none', color: '#ccc', cursor: 'pointer', fontSize: '20px', lineHeight: 1 }}>
                    ×
                  </button>
                </Form>
              </div>

              {/* Products */}
              {c.products.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                  {c.products.map(cp => (
                    <div key={cp.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px 6px 6px', border: '1px solid #eee', backgroundColor: '#fafafa' }}>
                      {cp.imageUrl && (
                        <img src={cp.imageUrl} alt={cp.productName}
                          style={{ width: '32px', height: '32px', objectFit: 'cover' }} />
                      )}
                      <span style={{ fontSize: '12px', fontWeight: '600' }}>{cp.productName}</span>
                      {cp.maxUnits && (
                        <span style={{ fontSize: '11px', color: '#666', marginLeft: '4px' }}>
                          max {cp.maxUnits} units
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: '13px', color: '#bbb' }}>No products.</div>
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
