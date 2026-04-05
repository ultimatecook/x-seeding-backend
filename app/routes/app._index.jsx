import { useLoaderData, Form, useRouteError } from 'react-router';
import { useState } from 'react';
import { boundary } from '@shopify/shopify-app-react-router/server';
import prisma from '../db.server';

const STATUSES = ['Pending', 'Ordered', 'Shipped', 'Delivered', 'Posted'];

const STATUS_STYLE = {
  Pending:   { background: '#FFF3CD', color: '#856404' },
  Ordered:   { background: '#FFE5CC', color: '#7A3B00' },
  Shipped:   { background: '#CCE5FF', color: '#004085' },
  Delivered: { background: '#D4EDDA', color: '#155724' },
  Posted:    { background: '#E2D9F3', color: '#4A235A' },
};

export async function loader({ request }) {
  const seedings = await prisma.seeding.findMany({
    include: { influencer: true, products: true },
    orderBy: { createdAt: 'desc' },
  });

  return { seedings };
}

export async function action({ request }) {
  const formData = await request.formData();
  const intent = formData.get('intent');

  if (intent === 'updateStatus') {
    await prisma.seeding.update({
      where: { id: parseInt(formData.get('id')) },
      data: { status: formData.get('status') },
    });
  }

  if (intent === 'updateTracking') {
    await prisma.seeding.update({
      where: { id: parseInt(formData.get('id')) },
      data: { trackingNumber: formData.get('trackingNumber') },
    });
  }

  if (intent === 'delete') {
    await prisma.seeding.delete({
      where: { id: parseInt(formData.get('id')) },
    });
  }

  return null;
}

const PERIODS = [
  { label: '7d', days: 7, display: '7 days' },
  { label: '30d', days: 30, display: '30 days' },
  { label: 'Q', days: 90, display: 'Quarterly' },
  { label: '1Y', days: 365, display: 'Yearly' },
];

function getTopProducts(seedings, days) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const map = {};
  for (const s of seedings) {
    if (new Date(s.createdAt) < cutoff) continue;
    for (const p of s.products) {
      if (!map[p.productId]) {
        map[p.productId] = { name: p.productName, image: p.imageUrl, count: 0, worth: 0 };
      }
      map[p.productId].count += 1;
      map[p.productId].worth += p.price;
    }
  }

  return Object.values(map)
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);
}

export default function Dashboard() {
  const { seedings } = useLoaderData();
  const [period, setPeriod] = useState('30d');

  const selectedPeriod = PERIODS.find(p => p.label === period);
  const topProducts = getTopProducts(seedings, selectedPeriod.days);

  const totalCost = seedings.reduce((sum, s) => sum + s.totalCost, 0);
  const totalUnits = seedings.reduce((sum, s) => sum + s.products.length, 0);
  const countries = [...new Set(seedings.map(s => s.influencer.country))];

  const stats = [
    { label: 'Total Seedings', value: seedings.length },
    { label: 'Total Invested', value: `€${Math.round(totalCost)}` },
    { label: 'Units Sent', value: totalUnits },
    { label: 'Countries', value: countries.length || 0 },
  ];

  return (
    <div>
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '40px' }}>
        {stats.map(({ label, value }) => (
          <div key={label} style={{ padding: '20px', backgroundColor: '#f5f5f5', borderLeft: '3px solid #000' }}>
            <div style={{ fontSize: '11px', color: '#666', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>{label}</div>
            <div style={{ fontSize: '32px', fontWeight: '900' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Status breakdown */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '32px' }}>
        {STATUSES.map(status => {
          const count = seedings.filter(s => s.status === status).length;
          return (
            <div key={status} style={{ padding: '8px 16px', ...STATUS_STYLE[status], borderRadius: '20px', fontSize: '13px', fontWeight: '600' }}>
              {status} · {count}
            </div>
          );
        })}
      </div>

      {/* Top Products */}
      <div style={{ marginBottom: '40px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, fontSize: '15px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Seeding in the past {selectedPeriod.display}
          </h2>
          <div style={{ display: 'flex', gap: '4px' }}>
            {PERIODS.map(p => (
              <button key={p.label} type="button" onClick={() => setPeriod(p.label)}
                style={{ padding: '5px 12px', fontSize: '12px', fontWeight: '600', border: '1px solid #000', cursor: 'pointer', backgroundColor: period === p.label ? '#000' : '#fff', color: period === p.label ? '#fff' : '#000', borderRadius: '3px' }}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {topProducts.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', border: '2px dashed #eee', color: '#bbb', fontSize: '13px' }}>
            No seedings in this period yet.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
            {topProducts.map((prod, i) => (
              <div key={prod.name} style={{ border: '1px solid #e8e8e8', borderRadius: '8px', overflow: 'hidden', backgroundColor: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                {/* Image */}
                <div style={{ position: 'relative' }}>
                  {prod.image ? (
                    <div style={{ width: '100%', aspectRatio: '4 / 3', backgroundColor: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                      <img src={prod.image} alt={prod.name} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
                    </div>
                  ) : (
                    <div style={{ width: '100%', aspectRatio: '4 / 3', backgroundColor: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '36px' }}>📦</div>
                  )}
                  <div style={{ position: 'absolute', top: '8px', left: '8px', backgroundColor: '#000', color: '#fff', fontSize: '10px', fontWeight: '800', padding: '3px 8px', borderRadius: '4px', letterSpacing: '0.3px' }}>
                    #{i + 1}
                  </div>
                </div>

                {/* Info */}
                <div style={{ padding: '12px 14px 14px' }}>
                  <div style={{ fontSize: '13px', fontWeight: '700', marginBottom: '10px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#111' }}>
                    {prod.name}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '5px' }}>
                      <span style={{ fontSize: '22px', fontWeight: '900', color: '#000', lineHeight: 1 }}>{prod.count}</span>
                      <span style={{ fontSize: '11px', color: '#888', fontWeight: '500', textTransform: 'uppercase', letterSpacing: '0.4px' }}>pieces seeded</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '5px' }}>
                      <span style={{ fontSize: '13px', fontWeight: '700', color: '#444' }}>€{prod.worth.toFixed(2)}</span>
                      <span style={{ fontSize: '11px', color: '#aaa', fontWeight: '400' }}>worth</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Table */}
      {seedings.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#999', border: '2px dashed #ddd' }}>
          <p style={{ margin: 0, fontSize: '16px' }}>No seedings yet.</p>
          <a href="/app/new" style={{ color: '#000', fontWeight: 'bold' }}>Create your first one →</a>
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #000' }}>
              {['Influencer', 'Country', 'Products', 'Cost', 'Status', 'Tracking', 'Checkout Link', 'Date', ''].map(h => (
                <th key={h} style={{ padding: '10px 8px', textAlign: 'left', fontWeight: '700', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {seedings.map(s => (
              <tr key={s.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '12px 8px', fontWeight: '600' }}>{s.influencer.handle}</td>
                <td style={{ padding: '12px 8px', color: '#666' }}>{s.influencer.country}</td>
                <td style={{ padding: '12px 8px', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.products.map(p => p.productName).join(', ')}
                </td>
                <td style={{ padding: '12px 8px', fontWeight: '600' }}>€{s.totalCost.toFixed(2)}</td>
                <td style={{ padding: '12px 8px' }}>
                  <Form method="post">
                    <input type="hidden" name="intent" value="updateStatus" />
                    <input type="hidden" name="id" value={s.id} />
                    <select name="status" defaultValue={s.status} onChange={e => e.target.form.requestSubmit()}
                      style={{ padding: '4px 8px', border: 'none', borderRadius: '12px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', ...STATUS_STYLE[s.status] }}>
                      {STATUSES.map(st => <option key={st} value={st}>{st}</option>)}
                    </select>
                  </Form>
                </td>
                <td style={{ padding: '12px 8px' }}>
                  <Form method="post" style={{ display: 'flex', gap: '4px' }}>
                    <input type="hidden" name="intent" value="updateTracking" />
                    <input type="hidden" name="id" value={s.id} />
                    <input type="text" name="trackingNumber" defaultValue={s.trackingNumber || ''} placeholder="Add tracking..." onBlur={e => e.target.form.requestSubmit()}
                      style={{ width: '130px', padding: '4px 6px', border: '1px solid #ddd', fontSize: '12px', color: '#333' }} />
                  </Form>
                </td>
                <td style={{ padding: '12px 8px', fontSize: '12px' }}>
                  {s.invoiceUrl ? (
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(s.invoiceUrl);
                        const btn = document.getElementById(`copy-${s.id}`);
                        if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy Link'; }, 2000); }
                      }}
                      id={`copy-${s.id}`}
                      style={{ padding: '4px 10px', fontSize: '11px', fontWeight: '700', backgroundColor: '#000', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      Copy Link
                    </button>
                  ) : (
                    <span style={{ color: '#ccc' }}>—</span>
                  )}
                </td>
                <td style={{ padding: '12px 8px', color: '#999', fontSize: '12px' }}>
                  {new Date(s.createdAt).toLocaleDateString('en-GB')}
                </td>
                <td style={{ padding: '12px 8px' }}>
                  <Form method="post" onSubmit={e => { if (!confirm('Delete this seeding?')) e.preventDefault(); }}>
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="id" value={s.id} />
                    <button type="submit" style={{ background: 'none', border: 'none', color: '#ccc', cursor: 'pointer', fontSize: '16px' }}>×</button>
                  </Form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
