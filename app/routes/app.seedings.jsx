import { useLoaderData, Form, useRouteError, useSearchParams, Link } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import { authenticate } from '../shopify.server';
import prisma from '../db.server';
import { C, btn, card, fmtDate } from '../theme';

const STATUSES  = ['Pending', 'Ordered', 'Shipped', 'Delivered', 'Posted'];
const PAGE_SIZE = 30;

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
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url      = new URL(request.url);
  const page     = Math.max(1, parseInt(url.searchParams.get('page')     || '1'));
  const status   = url.searchParams.get('status')   || 'all';
  const campaign = url.searchParams.get('campaign') || '';
  const country  = url.searchParams.get('country')  || '';
  const q        = url.searchParams.get('q')        || '';

  const where = { shop };
  if (status  !== 'all') where.status     = status;
  if (campaign)          where.campaignId = parseInt(campaign);

  // Country + search both filter via influencer relation — merge them
  const influencerWhere = { shop };
  if (country) influencerWhere.country = country;
  if (q) {
    influencerWhere.OR = [
      { handle: { contains: q, mode: 'insensitive' } },
      { name:   { contains: q, mode: 'insensitive' } },
    ];
  }
  where.influencer = influencerWhere;

  const [seedings, total, statusCounts, campaigns, allCountries] = await Promise.all([
    prisma.seeding.findMany({
      where,
      include: { influencer: true, products: true },
      orderBy: { createdAt: 'desc' },
      skip:    (page - 1) * PAGE_SIZE,
      take:    PAGE_SIZE,
    }),
    prisma.seeding.count({ where }),
    prisma.seeding.groupBy({ by: ['status'], where: { shop }, _count: { _all: true } }),
    prisma.campaign.findMany({ where: { shop, archived: false }, select: { id: true, title: true }, orderBy: { createdAt: 'desc' } }),
    // Distinct countries across seedings for this shop
    prisma.influencer.findMany({
      where:    { shop, seedings: { some: { shop } } },
      select:   { country: true },
      distinct: ['country'],
      orderBy:  { country: 'asc' },
    }),
  ]);

  const countsByStatus = STATUSES.reduce((acc, s) => {
    acc[s] = statusCounts.find(r => r.status === s)?._count._all ?? 0;
    return acc;
  }, {});

  const countries = allCountries.map(i => i.country).filter(Boolean).sort();

  return { seedings, total, page, countsByStatus, campaigns, countries };
}

// ── Action ───────────────────────────────────────────────────────────────────
export async function action({ request }) {
  const { session, admin } = await authenticate.admin(request);
  const shop     = session.shop;
  const formData = await request.formData();
  const intent   = formData.get('intent');
  const id       = parseInt(formData.get('id'));

  const VALID_STATUSES = ['Pending', 'Ordered', 'Shipped', 'Delivered', 'Posted'];

  if (intent === 'updateStatus') {
    const status = formData.get('status');
    if (!VALID_STATUSES.includes(status)) return null;
    await prisma.seeding.updateMany({ where: { id, shop }, data: { status } });
  }
  if (intent === 'updateTracking') {
    const trackingNumber = String(formData.get('trackingNumber') || '').slice(0, 200).trim() || null;
    await prisma.seeding.updateMany({ where: { id, shop }, data: { trackingNumber } });
  }
  if (intent === 'delete') {
    // Verify ownership before deletion
    const seeding = await prisma.seeding.findUnique({ where: { id } });
    if (!seeding || seeding.shop !== shop) return null;

    // If still Pending, also delete the Shopify draft order
    if (seeding.status === 'Pending' && seeding.shopifyDraftOrderId) {
      try {
        await admin.graphql(`
          #graphql
          mutation DeleteDraftOrder($id: ID!) {
            draftOrderDelete(input: { id: $id }) {
              deletedId
            }
          }
        `, { variables: { id: seeding.shopifyDraftOrderId } });
      } catch (e) {
        console.error('Failed to delete Shopify draft order:', e.message);
      }
    }

    await prisma.seeding.delete({ where: { id } });
  }
  return null;
}

// ── Component ────────────────────────────────────────────────────────────────
export default function Seedings() {
  const { seedings, total, page, countsByStatus, campaigns, countries } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();

  const currentStatus   = searchParams.get('status')   || 'all';
  const currentCampaign = searchParams.get('campaign') || '';
  const currentCountry  = searchParams.get('country')  || '';
  const currentQ        = searchParams.get('q')        || '';
  const totalPages      = Math.ceil(total / PAGE_SIZE);
  const hasFilters      = currentStatus !== 'all' || currentCampaign || currentCountry || currentQ;

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

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2 style={{ margin: 0, color: C.text }}>
          Seedings <span style={{ fontSize: '14px', fontWeight: '400', color: C.textMuted }}>({total})</span>
        </h2>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <a
            href={`/api/seedings-export?${searchParams.toString()}`}
            style={{ ...btn.ghost, textDecoration: 'none', display: 'inline-block' }}
          >
            ↓ Export CSV
          </a>
          <Link to="/app/new" style={{ ...btn.primary, textDecoration: 'none', display: 'inline-block' }}>+ New Seeding</Link>
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
        {/* Search */}
        <input
          type="text"
          placeholder="Search influencer…"
          defaultValue={currentQ}
          key={currentQ}
          onKeyDown={e => { if (e.key === 'Enter') setFilter('q', e.target.value); }}
          onBlur={e => { if (e.target.value !== currentQ) setFilter('q', e.target.value); }}
          style={{ padding: '8px 12px', border: `1px solid ${C.border}`, borderRadius: '6px', fontSize: '13px', width: '200px', backgroundColor: C.surface, color: C.text }}
        />

        {/* Status pills */}
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {['all', ...STATUSES].map(s => (
            <button key={s} type="button" onClick={() => setFilter('status', s)}
              style={{ padding: '6px 12px', fontSize: '12px', fontWeight: '600', borderRadius: '20px', cursor: 'pointer', border: `1px solid ${currentStatus === s ? C.accent : C.border}`, backgroundColor: currentStatus === s ? C.accentFaint : 'transparent', color: currentStatus === s ? C.accent : C.textSub, whiteSpace: 'nowrap' }}>
              {s === 'all' ? `All · ${Object.values(countsByStatus).reduce((a, b) => a + b, 0)}` : `${s} · ${countsByStatus[s]}`}
            </button>
          ))}
        </div>

        {/* Country filter */}
        {countries.length > 1 && (
          <select value={currentCountry} onChange={e => setFilter('country', e.target.value)}
            style={{ padding: '7px 12px', border: `1px solid ${currentCountry ? C.accent : C.border}`, borderRadius: '6px', fontSize: '13px', backgroundColor: currentCountry ? C.accentFaint : C.surface, color: currentCountry ? C.accent : C.textSub, cursor: 'pointer' }}>
            <option value="">All countries</option>
            {countries.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}

        {/* Campaign filter */}
        {campaigns.length > 0 && (
          <select value={currentCampaign} onChange={e => setFilter('campaign', e.target.value)}
            style={{ padding: '7px 12px', border: `1px solid ${currentCampaign ? C.accent : C.border}`, borderRadius: '6px', fontSize: '13px', backgroundColor: currentCampaign ? C.accentFaint : C.surface, color: currentCampaign ? C.accent : C.textSub, cursor: 'pointer' }}>
            <option value="">All campaigns</option>
            {campaigns.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        )}

        {/* Clear */}
        {hasFilters && (
          <button type="button" onClick={() => setSearchParams(new URLSearchParams(), { preventScrollReset: true })}
            style={{ ...btn.ghost }}>
            Clear ×
          </button>
        )}

        <span style={{ marginLeft: 'auto', fontSize: '12px', color: C.textMuted }}>
          {total} result{total !== 1 ? 's' : ''}{hasFilters ? ' matching filters' : ''}
        </span>
      </div>

      {/* Table */}
      {seedings.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: C.textMuted, border: `2px dashed ${C.border}`, borderRadius: '8px' }}>
          {hasFilters ? (
            <>
              <p style={{ margin: '0 0 12px', fontSize: '16px', color: C.textSub }}>No seedings match these filters.</p>
              <button type="button" onClick={() => setSearchParams(new URLSearchParams())} style={{ ...btn.ghost }}>Clear filters</button>
            </>
          ) : (
            <>
              <p style={{ margin: '0 0 12px', fontSize: '16px', color: C.textSub }}>No seedings yet.</p>
              <Link to="/app/new" style={{ color: C.accent, fontWeight: '700', textDecoration: 'none' }}>Create your first one →</Link>
            </>
          )}
        </div>
      ) : (
        <>
          <div style={{ ...card.flat, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  {['Influencer', 'Country', 'Ship To', 'Products', 'Cost', 'Status', 'Tracking', 'Checkout Link', 'Order', 'Date', ''].map(h => (
                    <th key={h} style={{ padding: '12px 12px', textAlign: 'left', fontWeight: '700', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.7px', color: C.textSub, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {seedings.map(s => {
                  const link = adminOrderLink(s);
                  return (
                    <tr key={s.id} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                      <td style={{ padding: '12px 12px', fontWeight: '700', color: C.text, whiteSpace: 'nowrap' }}>
                        {s.influencer.handle}
                        <div style={{ fontSize: '11px', fontWeight: '400', color: C.textMuted }}>{s.influencer.name}</div>
                      </td>
                      <td style={{ padding: '12px 12px', color: C.textSub }}>{s.influencer.country}</td>
                      <td style={{ padding: '12px 12px', maxWidth: '160px', color: C.textSub }}>
                        {s.shippingAddress ? (
                          <span style={{ fontSize: '11px', lineHeight: '1.4', display: 'block' }}>{s.shippingAddress}</span>
                        ) : (
                          <span style={{ fontSize: '11px', color: C.textMuted, fontStyle: 'italic' }}>
                            {s.status === 'Pending' ? 'Awaiting checkout' : '—'}
                          </span>
                        )}
                      </td>
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
                        {fmtDate(s.createdAt)}
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

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', marginTop: '20px' }}>
              <button type="button" onClick={() => setPage(page - 1)} disabled={page <= 1}
                style={{ ...btn.ghost, opacity: page <= 1 ? 0.4 : 1, cursor: page <= 1 ? 'not-allowed' : 'pointer' }}>
                ← Prev
              </button>

              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
                .reduce((acc, p, i, arr) => {
                  if (i > 0 && p - arr[i - 1] > 1) acc.push('...');
                  acc.push(p);
                  return acc;
                }, [])
                .map((p, i) => p === '...' ? (
                  <span key={`e-${i}`} style={{ fontSize: '13px', color: C.textMuted, padding: '0 4px' }}>…</span>
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
                {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
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
