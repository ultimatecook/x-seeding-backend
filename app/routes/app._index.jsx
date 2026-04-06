import { useLoaderData, useRouteError } from 'react-router';
import { useState } from 'react';
import { boundary } from '@shopify/shopify-app-react-router/server';
import prisma from '../db.server';
import { C, card, section, btn } from '../theme';

const STATUSES = ['Pending', 'Ordered', 'Shipped', 'Delivered', 'Posted'];

export async function loader() {
  const seedings = await prisma.seeding.findMany({
    include: {
      influencer: { select: { country: true } },
      products:   { select: { productId: true, productName: true, imageUrl: true, price: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return { seedings };
}

const PERIODS = [
  { label: '7d',  days: 7,   display: '7 days'    },
  { label: '30d', days: 30,  display: '30 days'   },
  { label: 'Q',   days: 90,  display: 'Quarterly' },
  { label: '1Y',  days: 365, display: 'Yearly'    },
];

function getTopProducts(seedings, days) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const map = {};
  for (const s of seedings) {
    if (new Date(s.createdAt) < cutoff) continue;
    for (const p of s.products) {
      if (!map[p.productId]) map[p.productId] = { name: p.productName, image: p.imageUrl, count: 0, worth: 0 };
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
  const topProducts    = getTopProducts(seedings, selectedPeriod.days);
  const totalCost      = seedings.reduce((sum, s) => sum + s.totalCost, 0);
  const totalUnits     = seedings.reduce((sum, s) => sum + s.products.length, 0);
  const countries      = [...new Set(seedings.map(s => s.influencer.country))];

  const stats = [
    { label: 'Total Seedings', value: seedings.length },
    { label: 'Total Invested', value: `€${Math.round(totalCost).toLocaleString()}` },
    { label: 'Units Sent',     value: totalUnits },
    { label: 'Countries',      value: countries.length || 0 },
  ];

  const statusCounts = STATUSES.reduce((acc, s) => {
    acc[s] = seedings.filter(sd => sd.status === s).length;
    return acc;
  }, {});

  return (
    <div>
      {/* Stat tiles */}
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
        {STATUSES.map(s => (
          <div key={s} style={{ padding: '5px 14px', ...C.status[s], borderRadius: '20px', fontSize: '12px', fontWeight: '700' }}>
            {s} · {statusCounts[s]}
          </div>
        ))}
      </div>

      {/* Top products */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, ...section.title, marginBottom: 0 }}>
            Top products — past {selectedPeriod.display}
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
                    <div style={{ width: '100%', aspectRatio: '4/3', backgroundColor: C.surfaceHigh, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <img src={prod.image} alt={prod.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    </div>
                  ) : (
                    <div style={{ width: '100%', aspectRatio: '4/3', backgroundColor: C.surfaceHigh, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '36px' }}>📦</div>
                  )}
                  <div style={{ position: 'absolute', top: '8px', left: '8px', backgroundColor: C.accent, color: '#fff', fontSize: '10px', fontWeight: '800', padding: '3px 8px', borderRadius: '4px' }}>#{i + 1}</div>
                </div>
                <div style={{ padding: '14px' }}>
                  <div style={{ fontSize: '13px', fontWeight: '700', marginBottom: '10px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: C.text }}>{prod.name}</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '5px', marginBottom: '4px' }}>
                    <span style={{ fontSize: '22px', fontWeight: '900', color: C.accent, lineHeight: 1 }}>{prod.count}</span>
                    <span style={{ fontSize: '11px', color: C.textSub, textTransform: 'uppercase', letterSpacing: '0.4px' }}>pieces seeded</span>
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: C.text }}>
                    €{prod.worth.toFixed(2)} <span style={{ fontSize: '11px', color: C.textMuted, fontWeight: '400' }}>worth</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
