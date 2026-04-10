import { useLoaderData, Form, useSearchParams, Link } from 'react-router';
import prisma from '../db.server';
import { requirePortalUser } from '../utils/portal-auth.server';
import { can, requirePermission } from '../utils/portal-permissions.js';
import { audit } from '../utils/audit.server.js';
import { fmtDate } from '../theme';
import { D } from '../utils/portal-theme';


const STATUS_META = {
  Pending:   { bg: D.statusPending.bg,   text: D.statusPending.color,   dot: D.statusPending.dot   },
  Ordered:   { bg: D.statusOrdered.bg,   text: D.statusOrdered.color,   dot: D.statusOrdered.dot   },
  Shipped:   { bg: D.statusShipped.bg,   text: D.statusShipped.color,   dot: D.statusShipped.dot   },
  Delivered: { bg: D.statusDelivered.bg, text: D.statusDelivered.color, dot: D.statusDelivered.dot },
  Posted:    { bg: D.statusPosted.bg,    text: D.statusPosted.color,    dot: D.statusPosted.dot    },
};


const STATUSES  = ['Pending', 'Ordered', 'Shipped', 'Delivered', 'Posted'];
const PAGE_SIZE = 30;

export async function loader({ request }) {
  const { shop, portalUser } = await requirePortalUser(request);
  requirePermission(portalUser.role, 'viewSeedings');

  const url      = new URL(request.url);
  const page     = Math.max(1, parseInt(url.searchParams.get('page')     || '1'));
  const status   = url.searchParams.get('status')   || 'all';
  const campaign = url.searchParams.get('campaign') || '';
  const country  = url.searchParams.get('country')  || '';
  const q        = url.searchParams.get('q')        || '';

  const where = { shop };
  if (status  !== 'all') where.status     = status;
  if (campaign)          where.campaignId = parseInt(campaign);

  const influencerWhere = {};
  if (country) influencerWhere.country = country;
  if (q) {
    influencerWhere.OR = [
      { handle: { contains: q, mode: 'insensitive' } },
      { name:   { contains: q, mode: 'insensitive' } },
    ];
  }
  if (Object.keys(influencerWhere).length > 0) where.influencer = influencerWhere;

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
    prisma.campaign.findMany({ where: { shop }, select: { id: true, title: true }, orderBy: { createdAt: 'desc' } }),
    prisma.influencer.findMany({
      where:    { seedings: { some: { shop } } },
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

  return { seedings, total, page, countsByStatus, campaigns, countries, role: portalUser.role };
}

export async function action({ request }) {
  const { shop, portalUser } = await requirePortalUser(request);

  const formData = await request.formData();
  const intent   = formData.get('intent');
  const VALID_STATUSES = ['Pending', 'Ordered', 'Shipped', 'Delivered', 'Posted'];

  if (intent === 'updateStatus') {
    requirePermission(portalUser.role, 'updateSeeding');
    const status = formData.get('status');
    if (!VALID_STATUSES.includes(status)) return null;
    const id = parseInt(formData.get('id'));
    await prisma.seeding.update({ where: { id }, data: { status } });
    await audit({ shop, portalUser, action: 'updated_status', entityType: 'seeding', entityId: id, detail: `Status → ${status}` });
  }

  if (intent === 'updateTracking') {
    requirePermission(portalUser.role, 'updateSeeding');
    const trackingNumber = String(formData.get('trackingNumber') || '').slice(0, 200).trim() || null;
    const id = parseInt(formData.get('id'));
    await prisma.seeding.update({ where: { id }, data: { trackingNumber } });
    await audit({ shop, portalUser, action: 'updated_tracking', entityType: 'seeding', entityId: id, detail: `Tracking → ${trackingNumber ?? 'cleared'}` });
  }

  if (intent === 'delete') {
    requirePermission(portalUser.role, 'deleteSeeding');
    const id = parseInt(formData.get('id'));
    const seeding = await prisma.seeding.findUnique({ where: { id }, include: { influencer: true } });
    await prisma.seeding.delete({ where: { id } });
    await audit({ shop, portalUser, action: 'deleted_seeding', entityType: 'seeding', entityId: id, detail: `Deleted seeding for ${seeding?.influencer?.handle ?? id}` });
  }

  return null;
}

export default function PortalSeedings() {
  const { seedings, total, page, countsByStatus, campaigns, countries, role } = useLoaderData();
  const canEdit   = can.updateSeeding(role);
  const canDelete = can.deleteSeeding(role);
  const canCreate = can.createSeeding(role);
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

  const btnGhost = { padding: '6px 14px', backgroundColor: 'transparent', color: D.textSub, border: `1px solid ${D.border}`, cursor: 'pointer', fontWeight: '600', fontSize: '12px', borderRadius: '7px' };

  return (
    <div style={{ display: 'grid', gap: '16px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: D.text, letterSpacing: '-0.3px' }}>Seedings</h2>
          <p style={{ margin: '2px 0 0', fontSize: '13px', color: D.textSub }}>{total} seeding{total !== 1 ? 's' : ''}{hasFilters ? ' matching filters' : ''}</p>
        </div>
        {canCreate && (
          <Link to="/portal/new" style={{ padding: '8px 18px', background: 'linear-gradient(135deg, #7C6FF7 0%, #9C8FFF 100%)', color: '#fff', borderRadius: '8px', textDecoration: 'none', fontSize: '13px', fontWeight: '700', boxShadow: '0 2px 6px rgba(124,111,247,0.35)' }}>
            + New Seeding
          </Link>
        )}
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="text" placeholder="Search influencer…"
          defaultValue={currentQ} key={currentQ}
          onKeyDown={e => { if (e.key === 'Enter') setFilter('q', e.target.value); }}
          onBlur={e => { if (e.target.value !== currentQ) setFilter('q', e.target.value); }}
          style={{ padding: '7px 12px', border: `1px solid ${D.border}`, borderRadius: '7px', fontSize: '13px', width: '190px', backgroundColor: D.surface, color: D.text }}
        />
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {['all', ...STATUSES].map(s => {
            const active = currentStatus === s;
            const m = s !== 'all' ? STATUS_META[s] : null;
            return (
              <button key={s} type="button" onClick={() => setFilter('status', s)} style={{
                padding: '5px 12px', fontSize: '12px', fontWeight: '600', borderRadius: '20px', cursor: 'pointer',
                border: `1.5px solid ${active ? (m?.dot ?? D.accent) : D.border}`,
                backgroundColor: active ? (m?.bg ?? D.accentLight) : 'transparent',
                color: active ? (m?.text ?? D.accent) : D.textSub, whiteSpace: 'nowrap',
              }}>
                {s === 'all' ? `All · ${Object.values(countsByStatus).reduce((a, b) => a + b, 0)}` : `${s} · ${countsByStatus[s]}`}
              </button>
            );
          })}
        </div>
        {countries.length > 1 && (
          <select value={currentCountry} onChange={e => setFilter('country', e.target.value)}
            style={{ padding: '7px 10px', border: `1px solid ${currentCountry ? D.accent : D.border}`, borderRadius: '7px', fontSize: '13px', backgroundColor: D.surface, color: currentCountry ? D.accent : D.textSub, cursor: 'pointer' }}>
            <option value="">All countries</option>
            {countries.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        {campaigns.length > 0 && (
          <select value={currentCampaign} onChange={e => setFilter('campaign', e.target.value)}
            style={{ padding: '7px 10px', border: `1px solid ${currentCampaign ? D.accent : D.border}`, borderRadius: '7px', fontSize: '13px', backgroundColor: D.surface, color: currentCampaign ? D.accent : D.textSub, cursor: 'pointer' }}>
            <option value="">All campaigns</option>
            {campaigns.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        )}
        {hasFilters && (
          <button type="button" onClick={() => setSearchParams(new URLSearchParams(), { preventScrollReset: true })} style={btnGhost}>Clear ×</button>
        )}
      </div>

      {seedings.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: D.textMuted, border: `2px dashed ${D.border}`, borderRadius: '12px' }}>
          {hasFilters ? (
            <>
              <p style={{ margin: '0 0 12px', fontSize: '15px', color: D.textSub }}>No seedings match these filters.</p>
              <button type="button" onClick={() => setSearchParams(new URLSearchParams())} style={btnGhost}>Clear filters</button>
            </>
          ) : (
            <>
              <p style={{ margin: '0 0 12px', fontSize: '15px', color: D.textSub }}>No seedings yet.</p>
              <Link to="/portal/new" style={{ color: D.accent, fontWeight: '700', textDecoration: 'none' }}>Create your first one →</Link>
            </>
          )}
        </div>
      ) : (
        <>
          <div style={{ backgroundColor: D.surface, border: `1px solid ${D.border}`, borderRadius: '12px', boxShadow: D.shadow, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ backgroundColor: D.bg }}>
                  {['Influencer', 'Country', 'Ship To', 'Products', 'Cost', 'Status', 'Tracking', 'Checkout Link', 'Date', ''].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: '700', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.7px', color: D.textMuted, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {seedings.map(s => {
                  const sm = STATUS_META[s.status] ?? { bg: D.surfaceHigh, text: D.textSub, dot: D.textMuted };
                  return (
                    <tr key={s.id} style={{ borderTop: `1px solid ${D.borderLight}` }}>
                      <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: '700', color: D.text }}>@{s.influencer.handle}</div>
                        <div style={{ fontSize: '11px', color: D.textMuted, marginTop: '1px' }}>{s.influencer.name}</div>
                      </td>
                      <td style={{ padding: '12px 14px', color: D.textSub, fontSize: '12px' }}>{s.influencer.country}</td>
                      <td style={{ padding: '12px 14px', maxWidth: '150px', color: D.textSub }}>
                        {s.shippingAddress ? (
                          <span style={{ fontSize: '11px', lineHeight: '1.4', display: 'block' }}>{s.shippingAddress}</span>
                        ) : (
                          <span style={{ fontSize: '11px', color: D.textMuted, fontStyle: 'italic' }}>
                            {s.status === 'Pending' ? 'Awaiting checkout' : '—'}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: D.textSub, fontSize: '12px' }}>
                        {s.products.map(p => p.productName).join(', ')}
                      </td>
                      <td style={{ padding: '12px 14px', fontWeight: '700', color: D.text, whiteSpace: 'nowrap' }}>€{s.totalCost.toFixed(2)}</td>
                      <td style={{ padding: '12px 14px' }}>
                        {canEdit ? (
                          <Form method="post">
                            <input type="hidden" name="intent" value="updateStatus" />
                            <input type="hidden" name="id" value={s.id} />
                            <select name="status" defaultValue={s.status} onChange={e => e.target.form.requestSubmit()}
                              style={{ padding: '4px 8px', border: 'none', borderRadius: '12px', fontSize: '11px', fontWeight: '700', cursor: 'pointer', backgroundColor: sm.bg, color: sm.text }}>
                              {STATUSES.map(st => <option key={st} value={st}>{st}</option>)}
                            </select>
                          </Form>
                        ) : (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '700', backgroundColor: sm.bg, color: sm.text }}>
                            <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: sm.dot }} />{s.status}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        {canEdit ? (
                          <Form method="post">
                            <input type="hidden" name="intent" value="updateTracking" />
                            <input type="hidden" name="id" value={s.id} />
                            <input type="text" name="trackingNumber" defaultValue={s.trackingNumber || ''} placeholder="Add tracking…"
                              onBlur={e => e.target.form.requestSubmit()}
                              style={{ width: '120px', padding: '4px 8px', border: `1px solid ${D.border}`, borderRadius: '6px', fontSize: '12px', color: D.text, backgroundColor: D.bg }} />
                          </Form>
                        ) : (
                          <span style={{ fontSize: '12px', color: D.textSub }}>{s.trackingNumber || '—'}</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        {s.invoiceUrl ? (
                          <button type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(s.invoiceUrl);
                              const b = document.getElementById(`copy-${s.id}`);
                              if (b) { b.textContent = 'Copied ✓'; setTimeout(() => { b.textContent = 'Copy'; }, 2000); }
                            }}
                            id={`copy-${s.id}`}
                            style={{ ...btnGhost, fontSize: '11px', padding: '4px 10px' }}>
                            Copy
                          </button>
                        ) : <span style={{ color: D.textMuted, fontSize: '12px' }}>—</span>}
                      </td>
                      <td style={{ padding: '12px 14px', color: D.textMuted, fontSize: '12px', whiteSpace: 'nowrap' }}>
                        {fmtDate(s.createdAt)}
                      </td>
                      {canDelete && (
                        <td style={{ padding: '12px 14px' }}>
                          <Form method="post" onSubmit={e => { if (!confirm('Delete this seeding?')) e.preventDefault(); }}>
                            <input type="hidden" name="intent" value="delete" />
                            <input type="hidden" name="id" value={s.id} />
                            <button type="submit" style={{ background: 'none', border: 'none', color: D.textMuted, cursor: 'pointer', fontSize: '18px', lineHeight: 1 }}>×</button>
                          </Form>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
              <button type="button" onClick={() => setPage(page - 1)} disabled={page <= 1}
                style={{ ...btnGhost, opacity: page <= 1 ? 0.4 : 1, cursor: page <= 1 ? 'not-allowed' : 'pointer' }}>← Prev</button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
                .reduce((acc, p, i, arr) => { if (i > 0 && p - arr[i - 1] > 1) acc.push('...'); acc.push(p); return acc; }, [])
                .map((p, i) => p === '...' ? (
                  <span key={`e-${i}`} style={{ fontSize: '13px', color: D.textMuted, padding: '0 4px' }}>…</span>
                ) : (
                  <button key={p} type="button" onClick={() => setPage(p)}
                    style={{ width: '34px', height: '34px', borderRadius: '7px', border: `1px solid ${page === p ? D.accent : D.border}`, backgroundColor: page === p ? D.accent : 'transparent', color: page === p ? '#fff' : D.textSub, fontWeight: '600', fontSize: '13px', cursor: 'pointer' }}>{p}</button>
                ))}
              <button type="button" onClick={() => setPage(page + 1)} disabled={page >= totalPages}
                style={{ ...btnGhost, opacity: page >= totalPages ? 0.4 : 1, cursor: page >= totalPages ? 'not-allowed' : 'pointer' }}>Next →</button>
              <span style={{ fontSize: '12px', color: D.textMuted, marginLeft: '8px' }}>
                {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
