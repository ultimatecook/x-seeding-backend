import { useLoaderData, Form, useRouteError, useSearchParams } from 'react-router';
import { useState } from 'react';
import { boundary } from '@shopify/shopify-app-react-router/server';
import prisma from '../db.server';
import { C, btn, card, section } from '../theme';

const STATUSES  = ['Pending', 'Ordered', 'Shipped', 'Delivered', 'Posted'];
const PAGE_SIZE = 30;

// ── Admin link helper ────────────────────────────────────────────────────────
function adminOrderLink(s) {
  if (!s.shop) return null;
  if (s.shopifyOrderName && s.status !== 'Pending') {
    return `https://${s.shop}/admin/orders/${s.shopifyOrderName.replace('#', '')}`;
  }
  if (s.shopifyDraftOrderId) {
    return `https://${s.shop}/admin/draft_orders/${s.shopifyDraftOrderId.split('/').pop()}`;
  }
  return null;
}

// ── Loader ───────────────────────────────────────────────────────────────────
export async function loader({ request }) {
  const url      = new URL(request.url);
  const page     = Math.max(1, parseInt(url.searchParams.get('page')     || '1'));
  const status   = url.searchParams.get('status')   || 'all';
  const campaign = url.searchParams.get('campaign') || '';
  const q        = url.searchParams.get('q')        || '';

  // Filters for the table
  const where = {};
  if (status   !== 'all') where.status     = status;
  if (campaign)           where.campaignId = parseInt(campaign);
  if (q) {
    where.influencer = {
      OR: [
        { handle: { contains: q, mode: 'insensitive' } },
        { name:   { contains: q, mode: 'insensitive' } },
      ],
    };
  }

  const [allForStats, tableSeedings, tableTotal, campaigns] = await Promise.all([
    // Lightweight — for stat tiles + top products only
    prisma.seeding.findMany({
      include: {
        influencer: { select: { country: true } },
        products:   { select: { productId: true, productName: true, imageUrl: true, price: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    // Paginated + filtered — for the table
    prisma.seeding.findMany({
      where,
      include: { influencer: true, products: true },
      orderBy: { createdAt: 'desc' },
      skip:    (page - 1) * PAGE_SIZE,
      take:    PAGE_SIZE,
    }),
    prisma.seeding.count({ where }),
    prisma.campaign.findMany({ select: { id: true, title: true }, orderBy: { createdAt: 'desc' } }),
  ]);

  return { allForStats, tableSeedings, tableTotal, page, campaigns };
}

// ── Action ───────────────────────────────────────────────────────────────────
export async function action({ request }) {
  const formData = await request.formData();
  const intent   = formData.get('intent');

  if (intent === 'updateStatus') {
    await prisma.seeding.update({
      where: { id: parseInt(formData.get('id')) },
      data:  { status: formData.get('status') },
    });
  }
  if (intent === 'updateTracking') {
    await prisma.seeding.update({
      where: { id: parseInt(formData.get('id')) },
      data:  { trackingNumber: formData.get('trackingNumber') },
    });
  }
  if (intent === 'delete') {
    await prisma.seeding.delete({ where: { id: parseInt(formData.get('id')) } });
  }
  return null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
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

// ── Component ────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { allForStats, tableSeedings, tableTotal, page, campaigns } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  const [period, setPeriod] = useState('30d');

  const currentStatus   = searchParams.get('status')   || 'all';
  const currentCampaign = searchParams.get('campaign') || '';
  const currentQ        = searchParams.get('q')        || '';

  function setFilter(key, value) {
    const next = new URLSearchParams(searchParams);
    next.set(key, value);
    next.set('page', '1');
    setSearchParams(next, { preventScrollReset: true });
  }

  function setPage(p) {
    const next = new URLSearchParams(searchParams);
    next.set('page', String(p));
    setSearchParams(next, { preventScrollReset: true });
  }

  const totalPages = Math.ceil(tableTotal / PAGE_SIZE);

  // Stats from all seedings (unfiltered)
  const selectedPeriod = PERIODS.find(p => p.label === period);
  const topProducts    = getTopProducts(allForStats, selectedPeriod.days);
  const totalCost      = allForStats.reduce((sum, s) => sum + s.totalCost, 0);
  const totalUnits     = allForStats.reduce((sum, s) => sum + s.products.length, 0);
  const countries      = [...new Set(allForStats.map(s => s.influencer.country))];

  const stats = [
    { label: 'Total Seedings', value: allForStats.length },
    { label: 'Total Invested', value: `€${Math.round(totalCost).toLocaleString()}` },
    { label: 'Units Sent',     value: totalUnits },
    { label: 'Countries',      value: countries.length || 0 },
  ];

  const statusCounts = STATUSES.reduce((acc, s) => {
    acc[s] = allForStats.filter(sd => sd.status === s).length;
    return acc;
  }, {});

  const hasFilters = currentStatus !== 'all' || currentCampaign || currentQ;

  return (
    <div>
      {/* ── Stat tiles ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '32px' }}>
        {stats.map(({ label, value }) => (
          <div key={label} style={{ ...card.base, borderLeft: `3px solid ${C.accent}` }}>
            <div style={{ fontSize: '11px', color: C.textSub, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '8px' }}>{label}</div>
            <div style={{ fontSize: '30px', fontWeight: '900', color: C.text }}>{value}</div>
          </div>
        ))}
      </div>

      {/* ── Status breakdown ── */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '32px', flexWrap: 'wrap' }}>
        {STATUSES.map(s => (
          <div key={s} style={{ padding: '5px 14px', ...C.status[s], borderRadius: '20px', fontSize: '12px', fontWeight: '700' }}>
            {s} · {statusCounts[s]}
          </div>
        ))}
      </div>

      {/* ── Top products ── */}
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
                  <div style={{ fontSize: '13px', fontWeight: '700', color: C.text }}>€{prod.worth.toFixed(2)} <span style={{ fontSize: '11px', color: C.textMuted, fontWeight: '400' }}>worth</span></div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Filter bar ── */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
        {/* Search */}
        <input
          type="text"
          placeholder="Search influencer…"
          defaultValue={currentQ}
          onKeyDown={e => { if (e.key === 'Enter') setFilter('q', e.target.value); }}
          onBlur={e => { if (e.target.value !== currentQ) setFilter('q', e.target.value); }}
          style={{ padding: '8px 12px', border: `1px solid ${C.border}`, borderRadius: '6px', fontSize: '13px', width: '200px', backgroundColor: C.surface, color: C.text }}
        />

        {/* Status filter */}
        <div style={{ display: 'flex', gap: '4px' }}>
          {['all', ...STATUSES].map(s => (
            <button key={s} type="button" onClick={() => setFilter('status', s)}
              style={{ padding: '6px 12px', fontSize: '12px', fontWeight: '600', borderRadius: '20px', cursor: 'pointer', border: `1px solid ${currentStatus === s ? C.accent : C.border}`, backgroundColor: currentStatus === s ? C.accentFaint : 'transparent', color: currentStatus === s ? C.accent : C.textSub }}>
              {s === 'all' ? 'All' : s}
              {s !== 'all' && <span style={{ marginLeft: '4px', opacity: 0.7 }}>· {statusCounts[s]}</span>}
            </button>
          ))}
        </div>

        {/* Campaign filter */}
        {campaigns.length > 0 && (
          <select value={currentCampaign} onChange={e => setFilter('campaign', e.target.value)}
            style={{ padding: '7px 12px', border: `1px solid ${currentCampaign ? C.accent : C.border}`, borderRadius: '6px', fontSize: '13px', backgroundColor: currentCampaign ? C.accentFaint : C.surface, color: currentCampaign ? C.accent : C.textSub, cursor: 'pointer' }}>
            <option value="">All campaigns</option>
            {campaigns.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        )}

        {/* Clear filters */}
        {hasFilters && (
          <button type="button" onClick={() => setSearchParams(new URLSearchParams(), { preventScrollReset: true })}
            style={{ padding: '6px 14px', fontSize: '12px', fontWeight: '600', border: `1px solid ${C.border}`, borderRadius: '6px', backgroundColor: 'transparent', color: C.textSub, cursor: 'pointer' }}>
            Clear ×
          </button>
        )}

        <span style={{ marginLeft: 'auto', fontSize: '12px', color: C.textMuted }}>
          {tableTotal} seeding{tableTotal !== 1 ? 's' : ''}{hasFilters ? ' matching' : ' total'}
        </span>
      </div>

      {/* ── Table ── */}
      {tableSeedings.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: C.textMuted, border: `2px dashed ${C.border}`, borderRadius: '8px' }}>
          {hasFilters ? (
            <>
              <p style={{ margin: '0 0 12px', fontSize: '16px', color: C.textSub }}>No seedings match these filters.</p>
              <button type="button" onClick={() => setSearchParams(new URLSearchParams())}
                style={{ ...btn.ghost }}>Clear filters</button>
            </>
          ) : (
            <>
              <p style={{ margin: '0 0 12px', fontSize: '16px', color: C.textSub }}>No seedings yet.</p>
              <a href="/app/new" style={{ color: C.accent, fontWeight: '700', textDecoration: 'none' }}>Create your first one →</a>
            </>
          )}
        </div>
      ) : (
        <>
          <div style={{ ...card.flat, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  {['Influencer', 'Country', 'Products', 'Cost', 'Status', 'Tracking', 'Checkout Link', 'Order', 'Date', ''].map(h => (
                    <th key={h} style={{ padding: '12px 12px', textAlign: 'left', fontWeight: '700', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.7px', color: C.textSub, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableSeedings.map(s => {
                  const link = adminOrderLink(s);
                  return (
                    <tr key={s.id} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                      <td style={{ padding: '12px 12px', fontWeight: '700', color: C.text, whiteSpace: 'nowrap' }}>{s.influencer.handle}</td>
                      <td style={{ padding: '12px 12px', color: C.textSub }}>{s.influencer.country}</td>
                      <td style={{ padding: '12px 12px', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.textSub }}>
                        {s.products.map(p => p.productName).join(', ')}
                      </td>
                      <td style={{ padding: '12px 12px', fontWeight: '700', color: C.text, whiteSpace: 'nowrap' }}>€{s.totalCost.toFixed(2)}</td>
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
                        <Form method="post" style={{ display: 'flex' }}>
                          <input type="hidden" name="intent" value="updateTracking" />
                          <input type="hidden" name="id" value={s.id} />
                          <input type="text" name="trackingNumber" defaultValue={s.trackingNumber || ''} placeholder="Add tracking…"
                            onBlur={e => e.target.form.requestSubmit()}
                            style={{ width: '120px', padding: '4px 8px', border: `1px solid ${C.border}`, borderRadius: '5px', fontSize: '12px', color: C.text, backgroundColor: C.overlay }} />
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
                        ) : <span style={{ color: C.textMuted }}>—</span>}
                      </td>
                      <td style={{ padding: '12px 12px' }}>
                        {link ? (
                          <a href={link} target="_top" rel="noopener noreferrer"
                            style={{ fontSize: '11px', fontWeight: '700', padding: '4px 10px', border: `1px solid ${C.border}`, borderRadius: '5px', color: C.textSub, textDecoration: 'none', display: 'inline-block', backgroundColor: C.surfaceHigh, whiteSpace: 'nowrap' }}>
                            {s.status === 'Pending' ? 'Draft ↗' : 'Order ↗'}
                          </a>
                        ) : <span style={{ color: C.textMuted }}>—</span>}
                      </td>
                      <td style={{ padding: '12px 12px', color: C.textMuted, fontSize: '12px', whiteSpace: 'nowrap' }}>
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
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Pagination ── */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', marginTop: '20px' }}>
              <button type="button" onClick={() => setPage(page - 1)} disabled={page <= 1}
                style={{ ...btn.ghost, opacity: page <= 1 ? 0.4 : 1, cursor: page <= 1 ? 'not-allowed' : 'pointer' }}>
                ← Prev
              </button>

              {/* Page numbers — show up to 7 around current */}
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
                .reduce((acc, p, i, arr) => {
                  if (i > 0 && p - arr[i - 1] > 1) acc.push('...');
                  acc.push(p);
                  return acc;
                }, [])
                .map((p, i) => p === '...' ? (
                  <span key={`ellipsis-${i}`} style={{ fontSize: '13px', color: C.textMuted, padding: '0 4px' }}>…</span>
                ) : (
                  <button key={p} type="button" onClick={() => setPage(p)}
                    style={{ width: '34px', height: '34px', borderRadius: '6px', border: `1px solid ${page === p ? C.accent : C.border}`, backgroundColor: page === p ? C.accent : 'transparent', color: page === p ? '#fff' : C.textSub, fontWeight: '600', fontSize: '13px', cursor: 'pointer' }}>
                    {p}
                  </button>
                ))
              }

              <button type="button" onClick={() => setPage(page + 1)} disabled={page >= totalPages}
                style={{ ...btn.ghost, opacity: page >= totalPages ? 0.4 : 1, cursor: page >= totalPages ? 'not-allowed' : 'pointer' }}>
                Next →
              </button>

              <span style={{ fontSize: '12px', color: C.textMuted, marginLeft: '8px' }}>
                {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, tableTotal)} of {tableTotal}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
