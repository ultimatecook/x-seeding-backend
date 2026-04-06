import { useLoaderData, Form, useRouteError } from 'react-router';
import { useState } from 'react';
import { boundary } from '@shopify/shopify-app-react-router/server';
import prisma from '../db.server';
import { C, btn, card, section } from '../theme';

const STATUSES = ['Pending', 'Ordered', 'Shipped', 'Delivered', 'Posted'];

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
    await prisma.seeding.delete({ where: { id: parseInt(formData.get('id')) } });
  }
  return null;
}

const PERIODS = [
  { label: '7d',  days: 7,   display: '7 days' },
  { label: '30d', days: 30,  display: '30 days' },
  { label: 'Q',   days: 90,  display: 'Quarterly' },
  { label: '1Y',  days: 365, display: 'Yearly' },
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
  return Object.values(map).sort((a, b) => b.count - a.count).slice(0, 4);
}

export default function Dashboard() {
  const { seedings } = useLoaderData();
  const [period, setPeriod] = useState('30d');

  const selectedPeriod = PERIODS.find(p => p.label === period);
  const topProducts = getTopProducts(seedings, selectedPeriod.days);
  const totalCost  = seedings.reduce((sum, s) => sum + s.totalCost, 0);
  const totalUnits = seedings.reduce((sum, s) => sum + s.products.length, 0);
  const countries  = [...new Set(seedings.map(s => s.influencer.country))];

  const stats = [
    { label: 'Total Seedings',  value: seedings.length },
    { label: 'Total Invested',  value: `€${Math.round(totalCost)}` },
    { label: 'Units Sent',      value: totalUnits },
    { label: 'Countries',       value: countries.length || 0 },
  ];

  return (
    <div>
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '32px' }}>
        {stats.map(({ label, value }) => (
          <div key={label} style={{ ...card.base, borderLeft: `3px solid ${C.accent}` }}>
            <div style={{ fontSize: '11px', color: C.textSub, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '8px' }}>{label}</div>
            <div style={{ fontSize: '30px', fontWeight: '900', color: C.text }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Status breakdown */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '32px', flexWrap: 'wrap' }}>
        {STATUSES.map(status => {
          const count = seedings.filter(s => s.status === status).length;
          return (
            <div key={status} style={{ padding: '5px 14px', ...C.status[status], borderRadius: '20px', fontSize: '12px', fontWeight: '700' }}>
              {status} · {count}
            </div>
          );
        })}
      </div>

      {/* Top Products */}
      <div style={{ marginBottom: '40px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, ...section.title, marginBottom: 0 }}>
            Seeding in the past {selectedPeriod.display}
          </h2>
          <div style={{ display: 'flex', gap: '4px' }}>
            {PERIODS.map(p => (
              <button key={p.label} type="button" onClick={() => setPeriod(p.label)}
                style={{ padding: '5px 12px', fontSize: '12px', fontWeight: '700', border: `1px solid ${period === p.label ? C.accent : C.border}`, cursor: 'pointer', borderRadius: '5px', backgroundColor: period === p.label ? C.accent : 'transparent', color: period === p.label ? '#fff' : C.textSub }}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {topProducts.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', border: `2px dashed ${C.border}`, color: C.textMuted, fontSize: '13px', borderRadius: '8px' }}>
            No seedings in this period yet.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
            {topProducts.map((prod, i) => (
              <div key={prod.name} style={{ ...card.flat, overflow: 'hidden' }}>
                <div style={{ position: 'relative' }}>
                  {prod.image ? (
                    <div style={{ width: '100%', aspectRatio: '4/3', backgroundColor: C.surfaceHigh, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                      <img src={prod.image} alt={prod.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    </div>
                  ) : (
                    <div style={{ width: '100%', aspectRatio: '4/3', backgroundColor: C.surfaceHigh, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '36px' }}>📦</div>
                  )}
                  <div style={{ position: 'absolute', top: '8px', left: '8px', backgroundColor: C.accent, color: '#fff', fontSize: '10px', fontWeight: '800', padding: '3px 8px', borderRadius: '4px' }}>
                    #{i + 1}
                  </div>
                </div>
                <div style={{ padding: '14px' }}>
                  <div style={{ fontSize: '13px', fontWeight: '700', marginBottom: '10px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: C.text }}>
                    {prod.name}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '5px' }}>
                      <span style={{ fontSize: '22px', fontWeight: '900', color: C.accent, lineHeight: 1 }}>{prod.count}</span>
                      <span style={{ fontSize: '11px', color: C.textSub, fontWeight: '500', textTransform: 'uppercase', letterSpacing: '0.4px' }}>pieces seeded</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '5px' }}>
                      <span style={{ fontSize: '13px', fontWeight: '700', color: C.text }}>€{prod.worth.toFixed(2)}</span>
                      <span style={{ fontSize: '11px', color: C.textMuted }}>worth</span>
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
        <div style={{ textAlign: 'center', padding: '60px', color: C.textMuted, border: `2px dashed ${C.border}`, borderRadius: '8px' }}>
          <p style={{ margin: '0 0 12px', fontSize: '16px', color: C.textSub }}>No seedings yet.</p>
          <a href="/app/new" style={{ color: C.accent, fontWeight: '700', textDecoration: 'none' }}>Create your first one →</a>
        </div>
      ) : (
        <div style={{ ...card.flat, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {['Influencer', 'Country', 'Products', 'Cost', 'Status', 'Tracking', 'Checkout Link', 'Date', ''].map(h => (
                  <th key={h} style={{ padding: '12px 12px', textAlign: 'left', fontWeight: '700', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.7px', color: C.textSub }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {seedings.map(s => (
                <tr key={s.id} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                  <td style={{ padding: '12px 12px', fontWeight: '700', color: C.text }}>{s.influencer.handle}</td>
                  <td style={{ padding: '12px 12px', color: C.textSub }}>{s.influencer.country}</td>
                  <td style={{ padding: '12px 12px', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.textSub }}>
                    {s.products.map(p => p.productName).join(', ')}
                  </td>
                  <td style={{ padding: '12px 12px', fontWeight: '700', color: C.text }}>€{s.totalCost.toFixed(2)}</td>
                  <td style={{ padding: '12px 12px' }}>
                    <Form method="post">
                      <input type="hidden" name="intent" value="updateStatus" />
                      <input type="hidden" name="id" value={s.id} />
                      <select name="status" defaultValue={s.status} onChange={e => e.target.form.requestSubmit()}
                        style={{ padding: '4px 8px', border: 'none', borderRadius: '12px', fontSize: '11px', fontWeight: '700', cursor: 'pointer', ...(C.status[s.status] ?? {}) }}>
                        {STATUSES.map(st => <option key={st} value={st}>{st}</option>)}
                      </select>
                    </Form>
                  </td>
                  <td style={{ padding: '12px 12px' }}>
                    <Form method="post" style={{ display: 'flex', gap: '4px' }}>
                      <input type="hidden" name="intent" value="updateTracking" />
                      <input type="hidden" name="id" value={s.id} />
                      <input type="text" name="trackingNumber" defaultValue={s.trackingNumber || ''} placeholder="Add tracking..."
                        onBlur={e => e.target.form.requestSubmit()}
                        style={{ width: '130px', padding: '5px 8px', border: `1px solid ${C.border}`, borderRadius: '5px', fontSize: '12px', color: C.text, backgroundColor: C.overlay }} />
                    </Form>
                  </td>
                  <td style={{ padding: '12px 12px' }}>
                    {s.invoiceUrl ? (
                      <button type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(s.invoiceUrl);
                          const b = document.getElementById(`copy-${s.id}`);
                          if (b) { b.textContent = 'Copied ✓'; setTimeout(() => { b.textContent = 'Copy Link'; }, 2000); }
                        }}
                        id={`copy-${s.id}`}
                        style={{ ...btn.ghost, fontSize: '11px', padding: '4px 10px' }}>
                        Copy Link
                      </button>
                    ) : (
                      <span style={{ color: C.textMuted }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: '12px 12px', color: C.textMuted, fontSize: '12px' }}>
                    {new Date(s.createdAt).toLocaleDateString('en-GB')}
                  </td>
                  <td style={{ padding: '12px 12px' }}>
                    <Form method="post" onSubmit={e => { if (!confirm('Delete this seeding?')) e.preventDefault(); }}>
                      <input type="hidden" name="intent" value="delete" />
                      <input type="hidden" name="id" value={s.id} />
                      <button type="submit" style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', fontSize: '18px', lineHeight: 1 }}>×</button>
                    </Form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
