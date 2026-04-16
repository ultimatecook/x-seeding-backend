import { useLoaderData, Link } from 'react-router';
import prisma from '../db.server';
import { requirePortalUser } from '../utils/portal-auth.server';
import { fmtDate, fmtNum } from '../theme';
import { D, FlagImg } from '../utils/portal-theme';

// ── Loader ────────────────────────────────────────────────────────────────────
export async function loader({ request }) {
  const { shop } = await requirePortalUser(request);

  const now              = new Date();
  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const start12Weeks     = new Date(now);
  start12Weeks.setDate(now.getDate() - 83);

  const [
    statusCounts,
    totalInfluencers,
    recentSeedings,
    topInfluencers,
    allSeedingsForCountry,
    weeklyRaw,
    thisMonthSpend,
    lastMonthSpend,
  ] = await Promise.all([
    prisma.seeding.groupBy({ by: ['status'], where: { shop }, _count: { _all: true } }),
    prisma.influencer.count({ where: { archived: false } }),
    prisma.seeding.findMany({
      where:   { shop },
      select:  { id: true, status: true, totalCost: true, createdAt: true,
                 influencer: { select: { id: true, handle: true, name: true, country: true } },
                 campaign:   { select: { id: true, title: true } } },
      orderBy: { createdAt: 'desc' },
      take:    8,
    }),
    prisma.influencer.findMany({
      where:   { archived: false },
      orderBy: { seedings: { _count: 'desc' } },
      take:    8,
      select:  { id: true, handle: true, name: true, followers: true, country: true,
                 _count:   { select: { seedings: true } },
                 seedings: { select: { totalCost: true } } },
    }),
    prisma.seeding.findMany({
      where:  { shop },
      select: { influencerId: true, totalCost: true, influencer: { select: { country: true } } },
      take:   2000,
    }),
    prisma.seeding.findMany({
      where:  { shop, createdAt: { gte: start12Weeks } },
      select: { createdAt: true, totalCost: true },
    }),
    prisma.seeding.aggregate({
      where: { shop, createdAt: { gte: startOfThisMonth } },
      _sum:  { totalCost: true }, _count: { _all: true },
    }),
    prisma.seeding.aggregate({
      where: { shop, createdAt: { gte: startOfLastMonth, lt: startOfThisMonth } },
      _sum:  { totalCost: true }, _count: { _all: true },
    }),
  ]);

  const allProductCosts = await prisma.seedingProduct.findMany({
    where:  { seeding: { shop } },
    select: { cost: true },
  });
  const totalCostValue = allProductCosts.reduce((s, p) => s + (p.cost ?? 0), 0);
  const hasCostData    = allProductCosts.some(p => p.cost != null);

  const countMap          = Object.fromEntries(statusCounts.map(r => [r.status, r._count._all]));
  const totalSeedings     = statusCounts.reduce((s, r) => s + r._count._all, 0);
  const pendingSeedings   = countMap['Pending']   ?? 0;
  const orderedSeedings   = countMap['Ordered']   ?? 0;
  const shippedSeedings   = countMap['Shipped']   ?? 0;
  const deliveredSeedings = countMap['Delivered'] ?? 0;
  const postedSeedings    = countMap['Posted']    ?? 0;

  const totalSpend     = allSeedingsForCountry.reduce((s, x) => s + (x.totalCost ?? 0), 0);
  const thisMonthTotal = thisMonthSpend._sum.totalCost ?? 0;
  const lastMonthTotal = lastMonthSpend._sum.totalCost ?? 0;
  const spendDelta     = lastMonthTotal > 0
    ? Math.round(((thisMonthTotal - lastMonthTotal) / lastMonthTotal) * 100)
    : null;

  const weeks = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(start12Weeks);
    d.setDate(d.getDate() + i * 7);
    return { weekStart: new Date(d), seedings: 0, spend: 0 };
  });
  for (const s of weeklyRaw) {
    const age = Math.floor((new Date(s.createdAt) - start12Weeks) / (7 * 24 * 60 * 60 * 1000));
    if (age >= 0 && age < 12) {
      weeks[age].seedings++;
      weeks[age].spend += s.totalCost ?? 0;
    }
  }

  const countryMap = {};
  for (const s of allSeedingsForCountry) {
    const c = s.influencer?.country || 'Unknown';
    if (!countryMap[c]) countryMap[c] = { seedings: 0, spend: 0, influencers: new Set() };
    countryMap[c].seedings++;
    countryMap[c].spend += s.totalCost ?? 0;
    if (s.influencerId) countryMap[c].influencers.add(s.influencerId);
  }
  const countryData = Object.entries(countryMap)
    .map(([country, d]) => ({ country, seedings: d.seedings, spend: d.spend, influencers: d.influencers.size }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 8);

  const topInfluencersWithSpend = topInfluencers.map(inf => ({
    ...inf,
    totalSpend: inf.seedings.reduce((s, x) => s + (x.totalCost ?? 0), 0),
  }));

  return {
    totalSeedings, pendingSeedings, orderedSeedings,
    shippedSeedings, deliveredSeedings, postedSeedings,
    totalInfluencers, recentSeedings, countryData,
    topInfluencers: topInfluencersWithSpend,
    totalSpend, totalCostValue, hasCostData,
    thisMonthTotal, lastMonthTotal, spendDelta,
    thisMonthCount: thisMonthSpend._count._all,
    weeks: weeks.map(w => ({ label: fmtWeekLabel(w.weekStart), seedings: w.seedings, spend: w.spend })),
  };
}

function fmtWeekLabel(d) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function fmtFollowers(n) {
  if (!n) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K`;
  return String(n);
}

// ── Shared card shell ─────────────────────────────────────────────────────────
function Card({ children, style = {} }) {
  return (
    <div style={{
      backgroundColor: 'var(--pt-surface)',
      border: '1px solid var(--pt-border)',
      borderRadius: '14px',
      boxShadow: 'var(--pt-shadow)',
      overflow: 'hidden',
      ...style,
    }}>
      {children}
    </div>
  );
}

function CardHeader({ title, right }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '14px 20px',
      borderBottom: '1px solid var(--pt-border)',
    }}>
      <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--pt-text-muted)' }}>
        {title}
      </span>
      {right}
    </div>
  );
}

// ── Status pill ───────────────────────────────────────────────────────────────
const STATUS_META = {
  Pending:   { bg: D.statusPending.bg,   text: D.statusPending.color,   dot: D.statusPending.dot   },
  Ordered:   { bg: D.statusOrdered.bg,   text: D.statusOrdered.color,   dot: D.statusOrdered.dot   },
  Shipped:   { bg: D.statusShipped.bg,   text: D.statusShipped.color,   dot: D.statusShipped.dot   },
  Delivered: { bg: D.statusDelivered.bg, text: D.statusDelivered.color, dot: D.statusDelivered.dot },
  Posted:    { bg: D.statusPosted.bg,    text: D.statusPosted.color,    dot: D.statusPosted.dot    },
};

function StatusPill({ status }) {
  const m = STATUS_META[status] || { bg: D.surfaceHigh, text: D.textSub, dot: D.textMuted };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      backgroundColor: m.bg, color: m.text,
      borderRadius: '20px', padding: '3px 9px',
      fontSize: '11px', fontWeight: '700', whiteSpace: 'nowrap',
    }}>
      <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: m.dot, flexShrink: 0 }} />
      {status}
    </span>
  );
}

// ── KPI stat card ─────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, accentColor }) {
  return (
    <Card>
      <div style={{ padding: '18px 20px' }}>
        <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--pt-text-muted)', marginBottom: '8px' }}>
          {label}
        </div>
        <div style={{ fontSize: '32px', fontWeight: '800', color: accentColor || 'var(--pt-text)', letterSpacing: '-1px', lineHeight: 1, marginBottom: '4px' }}>
          {value}
        </div>
        {sub && (
          <div style={{ fontSize: '11px', color: 'var(--pt-text-sub)' }}>
            {sub}
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Mini bar chart ────────────────────────────────────────────────────────────
function BarChart({ weeks }) {
  const maxVal = Math.max(...weeks.map(w => w.seedings), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: '72px' }}>
      {weeks.map((w, i) => {
        const pct    = (w.seedings / maxVal) * 100;
        const isLast = i === weeks.length - 1;
        const isRecent = i >= weeks.length - 3;
        return (
          <div
            key={i}
            title={`${w.label}: ${w.seedings} seeding${w.seedings !== 1 ? 's' : ''}`}
            style={{
              flex: 1,
              height: `${Math.max(pct, 5)}%`,
              borderRadius: '3px 3px 0 0',
              backgroundColor: isLast
                ? 'var(--pt-accent)'
                : isRecent
                  ? 'var(--pt-purple-faint)'
                  : 'var(--pt-surface-high)',
              border: isLast ? 'none' : '1px solid var(--pt-border-light)',
              cursor: 'default',
              transition: 'background-color 0.15s',
            }}
          />
        );
      })}
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export default function PortalDashboard() {
  const {
    totalSeedings, pendingSeedings, orderedSeedings,
    shippedSeedings, deliveredSeedings, postedSeedings,
    totalInfluencers, recentSeedings, countryData,
    topInfluencers, totalSpend, totalCostValue, hasCostData,
    thisMonthTotal, lastMonthTotal, spendDelta, thisMonthCount, weeks,
  } = useLoaderData();

  const activeSeedings       = orderedSeedings + shippedSeedings;
  const totalCountrySpend    = countryData.reduce((s, d) => s + d.spend, 0);
  const completionRate       = totalSeedings > 0
    ? Math.round(((deliveredSeedings + postedSeedings) / totalSeedings) * 100)
    : 0;

  const statusPipeline = [
    { label: 'Pending',   count: pendingSeedings,   color: D.statusPending.dot   },
    { label: 'Ordered',   count: orderedSeedings,   color: D.statusOrdered.dot   },
    { label: 'Shipped',   count: shippedSeedings,   color: D.statusShipped.dot   },
    { label: 'Delivered', count: deliveredSeedings, color: D.statusDelivered.dot },
    { label: 'Posted',    count: postedSeedings,    color: D.statusPosted.dot    },
  ];

  const deltaColor = spendDelta === null ? D.textMuted
    : spendDelta >= 0 ? '#16A34A' : '#DC2626';
  const deltaLabel = spendDelta === null ? null
    : `${spendDelta >= 0 ? '↑' : '↓'} ${Math.abs(spendDelta)}% vs last month`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '1100px' }}>

      {/* ── Page title ────────────────────────────────────────────── */}
      <div>
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: 'var(--pt-text)', letterSpacing: '-0.4px' }}>
          Dashboard
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--pt-text-sub)' }}>
          Overview of your influencer seeding activity.
        </p>
      </div>

      {/* ── Row 1: KPI cards ─────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
        <KpiCard
          label="Retail Value Seeded"
          value={`€${fmtNum(totalSpend)}`}
          sub={`${totalSeedings} seeding${totalSeedings !== 1 ? 's' : ''} total`}
        />
        <KpiCard
          label="Actual Cost"
          value={hasCostData ? `€${fmtNum(totalCostValue)}` : '—'}
          sub={hasCostData
            ? `${totalSpend > 0 ? Math.round((totalCostValue / totalSpend) * 100) : 0}% of retail`
            : 'Enable inventory scope'}
        />
        <KpiCard
          label="In Transit"
          value={activeSeedings}
          sub="Ordered + Shipped"
          accentColor="var(--pt-accent)"
        />
        <KpiCard
          label="Influencers"
          value={totalInfluencers}
          sub="Active roster"
          accentColor="var(--pt-purple)"
        />
      </div>

      {/* ── Row 2: Activity chart + Pipeline ─────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: '12px' }}>

        {/* Activity chart */}
        <Card>
          <div style={{ padding: '18px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
              <div>
                <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--pt-text-muted)', marginBottom: '4px' }}>
                  Seedings — Last 12 Weeks
                </div>
                <div style={{ fontSize: '22px', fontWeight: '800', color: 'var(--pt-text)', letterSpacing: '-0.5px', lineHeight: 1 }}>
                  {weeks.reduce((s, w) => s + w.seedings, 0)}
                </div>
              </div>
              {deltaLabel && (
                <span style={{ fontSize: '11px', fontWeight: '700', color: deltaColor, padding: '3px 8px', borderRadius: '6px', backgroundColor: spendDelta >= 0 ? 'var(--pt-status-delivered-bg)' : 'var(--pt-error-bg)' }}>
                  {deltaLabel}
                </span>
              )}
            </div>
            <BarChart weeks={weeks} />
            {/* x-axis */}
            <div style={{ display: 'flex', gap: '4px', marginTop: '5px' }}>
              {weeks.map((w, i) => (
                <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: '9px', color: 'var(--pt-text-muted)', overflow: 'hidden' }}>
                  {i % 3 === 0 ? w.label : ''}
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Pipeline */}
        <Card>
          <CardHeader title="Pipeline" />
          <div style={{ padding: '16px 20px' }}>
            {totalSeedings === 0 ? (
              <p style={{ margin: 0, color: 'var(--pt-text-muted)', fontSize: '13px' }}>No seedings yet.</p>
            ) : (
              <>
                {/* Stacked bar */}
                <div style={{ display: 'flex', height: '4px', borderRadius: '99px', overflow: 'hidden', backgroundColor: 'var(--pt-surface-high)', marginBottom: '16px' }}>
                  {statusPipeline.filter(s => s.count > 0).map(s => (
                    <div key={s.label} style={{ width: `${(s.count / totalSeedings) * 100}%`, backgroundColor: s.color }} />
                  ))}
                </div>
                {/* Status rows */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
                  {statusPipeline.map(s => (
                    <div key={s.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', minWidth: 0 }}>
                        <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: s.color, flexShrink: 0 }} />
                        <span style={{ fontSize: '12px', color: 'var(--pt-text-sub)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                        <div style={{ width: '50px', height: '3px', backgroundColor: 'var(--pt-surface-high)', borderRadius: '99px', overflow: 'hidden' }}>
                          <div style={{ width: `${(s.count / totalSeedings) * 100}%`, height: '100%', backgroundColor: s.color, borderRadius: '99px' }} />
                        </div>
                        <span style={{ fontSize: '13px', fontWeight: '800', color: 'var(--pt-text)', minWidth: '18px', textAlign: 'right' }}>{s.count}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--pt-border)', fontSize: '11px', color: 'var(--pt-text-muted)' }}>
                  {completionRate}% completion rate
                </div>
              </>
            )}
          </div>
        </Card>
      </div>

      {/* ── Row 3: Top Influencers ───────────────────────────────── */}
      <Card>
        <CardHeader
          title="Top Influencers"
          right={
            <Link to="/portal/influencers" style={{ fontSize: '11px', color: 'var(--pt-accent)', fontWeight: '700', textDecoration: 'none' }}>
              View all →
            </Link>
          }
        />
        {topInfluencers.length === 0 ? (
          <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--pt-text-muted)', fontSize: '13px' }}>
            No influencers yet.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '36px' }} />
              <col />
              <col style={{ width: '140px' }} />
              <col style={{ width: '90px' }} />
              <col style={{ width: '100px' }} />
              <col style={{ width: '120px' }} />
            </colgroup>
            <thead>
              <tr style={{ backgroundColor: 'var(--pt-bg)' }}>
                {['#', 'Influencer', 'Country', 'Followers', 'Seedings', 'Value'].map(h => (
                  <th key={h} style={{ textAlign: h === '#' ? 'center' : 'left', padding: '8px 16px', color: 'var(--pt-text-muted)', fontWeight: '700', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.6px', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {topInfluencers.map((inf, i) => (
                <tr key={inf.id} style={{ borderTop: '1px solid var(--pt-border-light)' }}>
                  <td style={{ padding: '11px 16px', textAlign: 'center', color: 'var(--pt-text-muted)', fontSize: '11px', fontWeight: '700' }}>
                    {i + 1}
                  </td>
                  <td style={{ padding: '11px 16px', overflow: 'hidden' }}>
                    <Link to={`/portal/influencers/${inf.id}`} style={{ textDecoration: 'none' }}>
                      <div style={{ fontWeight: '700', color: 'var(--pt-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {inf.name || `@${inf.handle}`}
                      </div>
                      {inf.name && (
                        <div style={{ fontSize: '11px', color: 'var(--pt-text-muted)', marginTop: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          @{inf.handle}
                        </div>
                      )}
                    </Link>
                  </td>
                  <td style={{ padding: '11px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                      <FlagImg country={inf.country} size={16} />
                      <span style={{ fontSize: '12px', color: 'var(--pt-text-sub)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inf.country || '—'}</span>
                    </div>
                  </td>
                  <td style={{ padding: '11px 16px', color: 'var(--pt-text-sub)', fontSize: '12px', fontWeight: '600' }}>
                    {fmtFollowers(inf.followers)}
                  </td>
                  <td style={{ padding: '11px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                      <div style={{ width: '48px', height: '3px', backgroundColor: 'var(--pt-surface-high)', borderRadius: '99px', overflow: 'hidden' }}>
                        <div style={{ width: `${(inf._count.seedings / (topInfluencers[0]._count.seedings || 1)) * 100}%`, height: '100%', backgroundColor: 'var(--pt-accent)', borderRadius: '99px' }} />
                      </div>
                      <span style={{ fontSize: '13px', fontWeight: '700', color: 'var(--pt-text)' }}>{inf._count.seedings}</span>
                    </div>
                  </td>
                  <td style={{ padding: '11px 16px', fontWeight: '800', color: 'var(--pt-accent)', fontSize: '13px' }}>
                    €{fmtNum(inf.totalSpend)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* ── Row 4: Country breakdown ─────────────────────────────── */}
      {countryData.length > 0 && (
        <Card>
          <CardHeader
            title="Reach by Country"
            right={
              <span style={{ fontSize: '11px', color: 'var(--pt-text-sub)' }}>
                {countryData.length} countr{countryData.length !== 1 ? 'ies' : 'y'} · €{fmtNum(totalCountrySpend)}
              </span>
            }
          />
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', tableLayout: 'fixed' }}>
            <colgroup>
              <col />
              <col style={{ width: '100px' }} />
              <col style={{ width: '90px' }} />
              <col style={{ width: '110px' }} />
              <col style={{ width: '160px' }} />
            </colgroup>
            <thead>
              <tr style={{ backgroundColor: 'var(--pt-bg)' }}>
                {['Country', 'Influencers', 'Seedings', 'Value', 'Share'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 16px', color: 'var(--pt-text-muted)', fontWeight: '700', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.6px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {countryData.map(d => {
                const pct = totalCountrySpend > 0 ? (d.spend / totalCountrySpend) * 100 : 0;
                return (
                  <tr key={d.country} style={{ borderTop: '1px solid var(--pt-border-light)' }}>
                    <td style={{ padding: '11px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                        <FlagImg country={d.country} size={18} />
                        <span style={{ fontWeight: '600', color: 'var(--pt-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.country}</span>
                      </div>
                    </td>
                    <td style={{ padding: '11px 16px', color: 'var(--pt-text-sub)', fontSize: '12px' }}>{d.influencers}</td>
                    <td style={{ padding: '11px 16px', color: 'var(--pt-text-sub)', fontSize: '12px' }}>{d.seedings}</td>
                    <td style={{ padding: '11px 16px', fontWeight: '700', color: 'var(--pt-text)', fontSize: '13px' }}>€{fmtNum(d.spend)}</td>
                    <td style={{ padding: '11px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ flex: 1, height: '4px', backgroundColor: 'var(--pt-surface-high)', borderRadius: '99px', overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', backgroundColor: 'var(--pt-accent)', borderRadius: '99px' }} />
                        </div>
                        <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--pt-text-muted)', minWidth: '28px', textAlign: 'right' }}>{Math.round(pct)}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {/* ── Row 5: Recent Seedings ───────────────────────────────── */}
      <Card>
        <CardHeader
          title="Recent Seedings"
          right={
            <Link to="/portal/seedings" style={{ fontSize: '11px', color: 'var(--pt-accent)', fontWeight: '700', textDecoration: 'none' }}>
              View all →
            </Link>
          }
        />
        {recentSeedings.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--pt-text-muted)', fontSize: '13px' }}>
            No seedings yet.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--pt-bg)' }}>
                {['Influencer', 'Campaign', 'Status', 'Value', 'Date'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 16px', color: 'var(--pt-text-muted)', fontWeight: '700', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.6px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentSeedings.map(s => (
                <tr key={s.id} style={{ borderTop: '1px solid var(--pt-border-light)' }}>
                  <td style={{ padding: '11px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {s.influencer?.country && (
                        <FlagImg country={s.influencer.country} size={15} />
                      )}
                      <div>
                        <div style={{ fontWeight: '700', color: 'var(--pt-text)' }}>
                          {s.influencer?.name || `@${s.influencer?.handle}`}
                        </div>
                        {s.influencer?.name && s.influencer?.handle && (
                          <div style={{ fontSize: '11px', color: 'var(--pt-text-muted)' }}>@{s.influencer.handle}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '11px 16px', fontSize: '12px' }}>
                    {s.campaign
                      ? <Link to={`/portal/campaigns/${s.campaign.id}`} style={{ color: 'var(--pt-accent)', fontWeight: '600', textDecoration: 'none' }}>{s.campaign.title}</Link>
                      : <span style={{ color: 'var(--pt-text-muted)' }}>—</span>}
                  </td>
                  <td style={{ padding: '11px 16px' }}><StatusPill status={s.status} /></td>
                  <td style={{ padding: '11px 16px', fontWeight: '700', color: 'var(--pt-text)', fontSize: '13px' }}>
                    {s.totalCost ? `€${fmtNum(s.totalCost)}` : '—'}
                  </td>
                  <td style={{ padding: '11px 16px', color: 'var(--pt-text-sub)', fontSize: '12px' }}>
                    {fmtDate(s.createdAt, 'medium')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

    </div>
  );
}
