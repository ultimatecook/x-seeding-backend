import { useState, useRef, useEffect, useCallback } from 'react';
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
    totalUnits,
    productStats,
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
      take:    6,
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
    // Total units ever sent
    prisma.seedingProduct.count({ where: { seeding: { shop } } }),
    // Product performance
    prisma.seedingProduct.groupBy({
      by:      ['productName'],
      where:   { seeding: { shop } },
      _count:  { _all: true },
      _sum:    { cost: true },
      orderBy: { _count: { _all: 'desc' } },
      take:    8,
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
  const thisMonthCount = thisMonthSpend._count._all;
  const lastMonthCount = lastMonthSpend._count._all;

  const spendDelta = lastMonthTotal > 0
    ? Math.round(((thisMonthTotal - lastMonthTotal) / lastMonthTotal) * 100)
    : null;
  const countDelta = lastMonthCount > 0
    ? Math.round(((thisMonthCount - lastMonthCount) / lastMonthCount) * 100)
    : null;

  // Weekly buckets
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

  // Country stats
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

  const topInfluencersData = topInfluencers.map(inf => ({
    ...inf,
    totalSpend: inf.seedings.reduce((s, x) => s + (x.totalCost ?? 0), 0),
  }));

  const topProducts = productStats.map(p => ({
    name:     p.productName,
    count:    p._count._all,
    costSum:  p._sum.cost ?? 0,
  }));

  return {
    totalSeedings, pendingSeedings, orderedSeedings,
    shippedSeedings, deliveredSeedings, postedSeedings,
    totalInfluencers, recentSeedings, countryData,
    topInfluencers: topInfluencersData, topProducts,
    totalSpend, totalCostValue, hasCostData, totalUnits,
    thisMonthTotal, thisMonthCount, spendDelta, countDelta,
    weeks: weeks.map(w => ({
      label:    fmtWeekLabel(w.weekStart),
      seedings: w.seedings,
      spend:    w.spend,
    })),
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

// ── Status meta ───────────────────────────────────────────────────────────────
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

// ── Delta badge ───────────────────────────────────────────────────────────────
function DeltaBadge({ delta }) {
  if (delta === null || delta === undefined) return null;
  const up  = delta >= 0;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '3px',
      fontSize: '11px', fontWeight: '700',
      color:           up ? '#15803D' : '#B91C1C',
      backgroundColor: up ? '#DCFCE7' : '#FEE2E2',
      padding: '2px 7px', borderRadius: '20px',
    }}>
      {up ? '↑' : '↓'} {Math.abs(delta)}%
    </span>
  );
}

// ── Dot-matrix chart (premium alternative to bar chart) ───────────────────────
function DotChart({ weeks }) {
  const maxSeedings = Math.max(...weeks.map(w => w.seedings), 1);
  const peakIdx     = weeks.reduce((best, w, i) => w.seedings > weeks[best].seedings ? i : best, 0);
  const MAX_DOTS    = 8;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '5px', height: '80px' }}>
        {weeks.map((w, i) => {
          const filled   = maxSeedings > 0 ? Math.max(Math.round((w.seedings / maxSeedings) * MAX_DOTS), w.seedings > 0 ? 1 : 0) : 0;
          const isPeak   = i === peakIdx && maxSeedings > 0;
          const isRecent = i >= weeks.length - 4;

          return (
            <div
              key={i}
              title={`${w.label}: ${w.seedings} seedings`}
              style={{ flex: 1, display: 'flex', flexDirection: 'column-reverse', alignItems: 'center', gap: '3px', height: '100%', justifyContent: 'flex-start' }}
            >
              {Array.from({ length: MAX_DOTS }, (_, di) => (
                <div
                  key={di}
                  style={{
                    width:         '100%',
                    maxWidth:      '10px',
                    height:        '8px',
                    borderRadius:  '50%',
                    backgroundColor: di < filled
                      ? isPeak   ? '#7C6FF7'
                      : isRecent ? '#A78BFA'
                      :            '#D4D0FB'
                      : 'var(--pt-surface-high)',
                    flexShrink: 0,
                    transition: 'background-color 0.2s',
                  }}
                />
              ))}
            </div>
          );
        })}
      </div>
      {/* X-axis */}
      <div style={{ display: 'flex', gap: '5px', marginTop: '8px' }}>
        {weeks.map((w, i) => (
          <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: '9px', color: 'var(--pt-text-muted)', overflow: 'hidden', whiteSpace: 'nowrap' }}>
            {i % 3 === 0 ? w.label : ''}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Widget shell with drag handle ─────────────────────────────────────────────
function Widget({ id, children, onDragStart, onDragOver, onDrop, onDragEnd, isDraggingOver, style = {} }) {
  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, id)}
      onDragOver={e  => onDragOver(e, id)}
      onDrop={e      => onDrop(e, id)}
      onDragEnd={onDragEnd}
      style={{
        position: 'relative',
        borderRadius: '14px',
        transition: 'opacity 0.15s, box-shadow 0.15s',
        outline: isDraggingOver ? '2px solid var(--pt-accent)' : 'none',
        outlineOffset: '2px',
        cursor: 'grab',
        ...style,
      }}
    >
      {/* Drag handle — top-right corner */}
      <div
        title="Drag to reorder"
        style={{
          position: 'absolute', top: '10px', right: '10px', zIndex: 10,
          fontSize: '14px', color: 'var(--pt-text-muted)',
          opacity: 0, transition: 'opacity 0.15s',
          userSelect: 'none', cursor: 'grab', lineHeight: 1,
          padding: '2px 4px',
        }}
        className="drag-handle"
      >
        ⠿
      </div>
      {children}
    </div>
  );
}

// ── Shared card ───────────────────────────────────────────────────────────────
function Card({ children, style = {} }) {
  return (
    <div style={{
      backgroundColor: 'var(--pt-surface)',
      border: '1px solid var(--pt-border)',
      borderRadius: '14px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
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
      padding: '14px 20px', borderBottom: '1px solid var(--pt-border)',
    }}>
      <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--pt-text-muted)' }}>
        {title}
      </span>
      {right}
    </div>
  );
}

// ── Widget definitions ────────────────────────────────────────────────────────
const WIDGET_DEFS = [
  { id: 'activity',     label: 'Activity Chart'  },
  { id: 'influencers',  label: 'Top Influencers' },
  { id: 'countries',    label: 'Countries'       },
  { id: 'products',     label: 'Products'        },
  { id: 'recent',       label: 'Recent Seedings' },
];
const DEFAULT_ORDER = WIDGET_DEFS.map(w => w.id);

// ── Dashboard ─────────────────────────────────────────────────────────────────
export default function PortalDashboard() {
  const {
    totalSeedings, pendingSeedings, orderedSeedings,
    shippedSeedings, deliveredSeedings, postedSeedings,
    totalInfluencers, recentSeedings, countryData, topProducts,
    topInfluencers, totalSpend, totalCostValue, hasCostData, totalUnits,
    thisMonthTotal, thisMonthCount, spendDelta, countDelta, weeks,
  } = useLoaderData();

  const activeSeedings    = orderedSeedings + shippedSeedings;
  const completionRate    = totalSeedings > 0
    ? Math.round(((deliveredSeedings + postedSeedings) / totalSeedings) * 100) : 0;
  const totalCountrySpend = countryData.reduce((s, d) => s + d.spend, 0);
  const maxProduct        = topProducts[0]?.count || 1;

  // ── Widget order + visibility (localStorage) ─────────────────────────────
  const [widgetOrder, setWidgetOrder] = useState(DEFAULT_ORDER);
  const [hiddenWidgets, setHiddenWidgets] = useState(() => new Set());
  const [showCustomize, setShowCustomize] = useState(false);

  useEffect(() => {
    try {
      const savedOrder  = localStorage.getItem('dash-order');
      const savedHidden = localStorage.getItem('dash-hidden');
      if (savedOrder)  setWidgetOrder(JSON.parse(savedOrder));
      if (savedHidden) setHiddenWidgets(new Set(JSON.parse(savedHidden)));
    } catch {}
  }, []);

  const toggleHidden = (id) => {
    setHiddenWidgets(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      localStorage.setItem('dash-hidden', JSON.stringify([...next]));
      return next;
    });
  };

  // ── Drag-and-drop ─────────────────────────────────────────────────────────
  const draggingId  = useRef(null);
  const [dragOver, setDragOver] = useState(null);

  const handleDragStart = useCallback((e, id) => {
    draggingId.current = id;
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e, id) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(id);
  }, []);

  const handleDrop = useCallback((e, targetId) => {
    e.preventDefault();
    setDragOver(null);
    const fromId = draggingId.current;
    if (!fromId || fromId === targetId) return;
    setWidgetOrder(prev => {
      const next = [...prev];
      const fromIdx = next.indexOf(fromId);
      const toIdx   = next.indexOf(targetId);
      next.splice(fromIdx, 1);
      next.splice(toIdx, 0, fromId);
      localStorage.setItem('dash-order', JSON.stringify(next));
      return next;
    });
    draggingId.current = null;
  }, []);

  const handleDragEnd = useCallback(() => {
    setDragOver(null);
    draggingId.current = null;
  }, []);

  // ── Status pipeline ───────────────────────────────────────────────────────
  const pipeline = [
    { label: 'Pending',   count: pendingSeedings,   color: D.statusPending.dot   },
    { label: 'Ordered',   count: orderedSeedings,   color: D.statusOrdered.dot   },
    { label: 'Shipped',   count: shippedSeedings,   color: D.statusShipped.dot   },
    { label: 'Delivered', count: deliveredSeedings, color: D.statusDelivered.dot },
    { label: 'Posted',    count: postedSeedings,    color: D.statusPosted.dot    },
  ];

  const peakWeek = weeks.reduce((best, w) => w.seedings > best.seedings ? w : best, weeks[0] ?? { label: '', seedings: 0 });

  // ── Widget renderers ──────────────────────────────────────────────────────
  const renderWidget = (id) => {
    if (hiddenWidgets.has(id)) return null;

    if (id === 'activity') return (
      <Widget key={id} id={id} onDragStart={handleDragStart} onDragOver={handleDragOver} onDrop={handleDrop} isDraggingOver={dragOver === id} onDragEnd={handleDragEnd}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: '12px' }} onDragEnd={handleDragEnd}>

          {/* Dot chart */}
          <Card>
            <div style={{ padding: '20px 22px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '18px' }}>
                <div>
                  <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--pt-text-muted)', marginBottom: '6px' }}>
                    Seedings — Last 12 Weeks
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
                    <span style={{ fontSize: '28px', fontWeight: '800', color: 'var(--pt-text)', letterSpacing: '-0.8px' }}>
                      {weeks.reduce((s, w) => s + w.seedings, 0)}
                    </span>
                    <DeltaBadge delta={countDelta} />
                  </div>
                </div>
                {peakWeek.seedings > 0 && (
                  <span style={{ fontSize: '11px', color: 'var(--pt-text-muted)', backgroundColor: 'var(--pt-surface-high)', padding: '4px 10px', borderRadius: '20px', border: '1px solid var(--pt-border)' }}>
                    Peak: <strong style={{ color: 'var(--pt-text)' }}>{peakWeek.label}</strong>
                  </span>
                )}
              </div>
              <DotChart weeks={weeks} />
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
                  <div style={{ display: 'flex', height: '4px', borderRadius: '99px', overflow: 'hidden', backgroundColor: 'var(--pt-surface-high)', marginBottom: '16px' }}>
                    {pipeline.filter(s => s.count > 0).map(s => (
                      <div key={s.label} style={{ width: `${(s.count / totalSeedings) * 100}%`, backgroundColor: s.color }} />
                    ))}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
                    {pipeline.map(s => (
                      <div key={s.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                          <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: s.color, flexShrink: 0 }} />
                          <span style={{ fontSize: '12px', color: 'var(--pt-text-sub)' }}>{s.label}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{ width: '48px', height: '3px', backgroundColor: 'var(--pt-surface-high)', borderRadius: '99px', overflow: 'hidden' }}>
                            <div style={{ width: `${(s.count / totalSeedings) * 100}%`, height: '100%', backgroundColor: s.color }} />
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
      </Widget>
    );

    if (id === 'influencers') return (
      <Widget key={id} id={id} onDragStart={handleDragStart} onDragOver={handleDragOver} onDrop={handleDrop} isDraggingOver={dragOver === id} onDragEnd={handleDragEnd}>
        <Card>
          <CardHeader
            title="Top Influencers"
            right={<Link to="/portal/influencers" style={{ fontSize: '11px', color: 'var(--pt-accent)', fontWeight: '700', textDecoration: 'none' }}>View all →</Link>}
          />
          {topInfluencers.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', color: 'var(--pt-text-muted)', fontSize: '13px' }}>No influencers yet.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: '32px' }} /><col /><col style={{ width: '130px' }} />
                <col style={{ width: '85px' }} /><col style={{ width: '110px' }} /><col style={{ width: '110px' }} />
              </colgroup>
              <thead>
                <tr style={{ backgroundColor: 'var(--pt-bg)' }}>
                  {['#', 'Influencer', 'Country', 'Followers', 'Seedings', 'Value'].map(h => (
                    <th key={h} style={{ textAlign: h === '#' ? 'center' : 'left', padding: '8px 16px', color: 'var(--pt-text-muted)', fontWeight: '700', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.6px' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {topInfluencers.map((inf, i) => (
                  <tr key={inf.id} style={{ borderTop: '1px solid var(--pt-border-light)' }}>
                    <td style={{ padding: '11px 16px', textAlign: 'center', color: 'var(--pt-text-muted)', fontSize: '11px', fontWeight: '700' }}>{i + 1}</td>
                    <td style={{ padding: '11px 16px', overflow: 'hidden' }}>
                      <Link to={`/portal/influencers/${inf.id}`} style={{ textDecoration: 'none' }}>
                        <div style={{ fontWeight: '700', color: 'var(--pt-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inf.name || `@${inf.handle}`}</div>
                        {inf.name && <div style={{ fontSize: '11px', color: 'var(--pt-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>@{inf.handle}</div>}
                      </Link>
                    </td>
                    <td style={{ padding: '11px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                        <FlagImg country={inf.country} size={15} />
                        <span style={{ fontSize: '12px', color: 'var(--pt-text-sub)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inf.country || '—'}</span>
                      </div>
                    </td>
                    <td style={{ padding: '11px 16px', color: 'var(--pt-text-sub)', fontSize: '12px', fontWeight: '600' }}>{fmtFollowers(inf.followers)}</td>
                    <td style={{ padding: '11px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                        <div style={{ width: '44px', height: '3px', backgroundColor: 'var(--pt-surface-high)', borderRadius: '99px', overflow: 'hidden' }}>
                          <div style={{ width: `${(inf._count.seedings / (topInfluencers[0]._count.seedings || 1)) * 100}%`, height: '100%', backgroundColor: 'var(--pt-accent)' }} />
                        </div>
                        <span style={{ fontSize: '13px', fontWeight: '700', color: 'var(--pt-text)' }}>{inf._count.seedings}</span>
                      </div>
                    </td>
                    <td style={{ padding: '11px 16px', fontWeight: '800', color: 'var(--pt-accent)', fontSize: '13px' }}>€{fmtNum(inf.totalSpend)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </Widget>
    );

    if (id === 'countries') return (
      <Widget key={id} id={id} onDragStart={handleDragStart} onDragOver={handleDragOver} onDrop={handleDrop} isDraggingOver={dragOver === id} onDragEnd={handleDragEnd}
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>

        {/* Countries */}
        <Card>
          <CardHeader
            title="Top Countries"
            right={<span style={{ fontSize: '11px', color: 'var(--pt-text-sub)' }}>{countryData.length} countr{countryData.length !== 1 ? 'ies' : 'y'}</span>}
          />
          {countryData.length === 0 ? (
            <div style={{ padding: '24px', color: 'var(--pt-text-muted)', fontSize: '13px' }}>No data yet.</div>
          ) : (
            <div style={{ padding: '8px 0' }}>
              {countryData.map(d => {
                const pct = totalCountrySpend > 0 ? (d.spend / totalCountrySpend) * 100 : 0;
                return (
                  <div key={d.country} style={{ padding: '9px 20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <FlagImg country={d.country} size={18} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--pt-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.country}</span>
                        <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--pt-text)', flexShrink: 0, marginLeft: '8px' }}>€{fmtNum(d.spend)}</span>
                      </div>
                      <div style={{ height: '3px', backgroundColor: 'var(--pt-surface-high)', borderRadius: '99px', overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', backgroundColor: 'var(--pt-accent)', borderRadius: '99px' }} />
                      </div>
                    </div>
                    <span style={{ fontSize: '11px', color: 'var(--pt-text-muted)', flexShrink: 0, minWidth: '28px', textAlign: 'right' }}>{Math.round(pct)}%</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Products */}
        <Card>
          <CardHeader title="Product Performance" />
          {topProducts.length === 0 ? (
            <div style={{ padding: '24px', color: 'var(--pt-text-muted)', fontSize: '13px' }}>No data yet.</div>
          ) : (
            <div style={{ padding: '8px 0' }}>
              {topProducts.map((p, i) => (
                <div key={p.name} style={{ padding: '9px 20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--pt-text-muted)', minWidth: '16px' }}>{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--pt-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                      <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--pt-text)', flexShrink: 0, marginLeft: '8px' }}>{p.count}×</span>
                    </div>
                    <div style={{ height: '3px', backgroundColor: 'var(--pt-surface-high)', borderRadius: '99px', overflow: 'hidden' }}>
                      <div style={{ width: `${(p.count / maxProduct) * 100}%`, height: '100%', backgroundColor: 'var(--pt-purple)', borderRadius: '99px' }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </Widget>
    );

    if (id === 'recent') return (
      <Widget key={id} id={id} onDragStart={handleDragStart} onDragOver={handleDragOver} onDrop={handleDrop} isDraggingOver={dragOver === id} onDragEnd={handleDragEnd}>
        <Card>
          <CardHeader
            title="Recent Seedings"
            right={<Link to="/portal/seedings" style={{ fontSize: '11px', color: 'var(--pt-accent)', fontWeight: '700', textDecoration: 'none' }}>View all →</Link>}
          />
          {recentSeedings.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--pt-text-muted)', fontSize: '13px' }}>No seedings yet.</div>
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
                        {s.influencer?.country && <FlagImg country={s.influencer.country} size={14} />}
                        <div>
                          <div style={{ fontWeight: '700', color: 'var(--pt-text)' }}>{s.influencer?.name || `@${s.influencer?.handle}`}</div>
                          {s.influencer?.name && <div style={{ fontSize: '11px', color: 'var(--pt-text-muted)' }}>@{s.influencer.handle}</div>}
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '11px 16px', fontSize: '12px' }}>
                      {s.campaign
                        ? <Link to={`/portal/campaigns/${s.campaign.id}`} style={{ color: 'var(--pt-accent)', fontWeight: '600', textDecoration: 'none' }}>{s.campaign.title}</Link>
                        : <span style={{ color: 'var(--pt-text-muted)' }}>—</span>}
                    </td>
                    <td style={{ padding: '11px 16px' }}><StatusPill status={s.status} /></td>
                    <td style={{ padding: '11px 16px', fontWeight: '700', color: 'var(--pt-text)' }}>{s.totalCost ? `€${fmtNum(s.totalCost)}` : '—'}</td>
                    <td style={{ padding: '11px 16px', color: 'var(--pt-text-sub)', fontSize: '12px' }}>{fmtDate(s.createdAt, 'medium')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </Widget>
    );

    return null;
  };

  // ── KPI cards (fixed, not draggable) ─────────────────────────────────────
  const kpis = [
    {
      label: 'Retail Value Seeded',
      value: `€${fmtNum(totalSpend)}`,
      sub:   `€${fmtNum(thisMonthTotal)} this month`,
      delta: spendDelta,
    },
    {
      label: 'Total Seedings',
      value: String(totalSeedings),
      sub:   `${thisMonthCount} this month`,
      delta: countDelta,
    },
    {
      label: 'Units Sent',
      value: String(totalUnits),
      sub:   'Products shipped',
      accentColor: 'var(--pt-purple)',
    },
    {
      label: 'In Transit',
      value: String(activeSeedings),
      sub:   'Ordered + Shipped',
      accentColor: 'var(--pt-accent)',
    },
    {
      label: 'Influencers',
      value: String(totalInfluencers),
      sub:   'Active roster',
    },
  ];

  return (
    <div style={{ maxWidth: '1100px' }}>

      {/* ── Drag handle CSS (show on hover via native CSS) ─────── */}
      <style>{`
        [draggable]:hover .drag-handle { opacity: 1 !important; }
        [draggable]:active { opacity: 0.6; cursor: grabbing; }
      `}</style>

      {/* ── Page header ───────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '20px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: 'var(--pt-text)', letterSpacing: '-0.4px' }}>Dashboard</h1>
          <p style={{ margin: '3px 0 0', fontSize: '13px', color: 'var(--pt-text-sub)' }}>Your influencer seeding overview.</p>
        </div>
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowCustomize(v => !v)}
            style={{ padding: '7px 14px', borderRadius: '8px', border: '1px solid var(--pt-border)', backgroundColor: showCustomize ? 'var(--pt-accent-light)' : 'var(--pt-surface)', color: showCustomize ? 'var(--pt-accent)' : 'var(--pt-text-sub)', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
            ⚙ Customize
          </button>
          {showCustomize && (
            <div style={{
              position: 'absolute', top: '38px', right: 0, zIndex: 100,
              backgroundColor: 'var(--pt-surface)', border: '1px solid var(--pt-border)',
              borderRadius: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
              padding: '12px', minWidth: '200px',
            }}>
              <div style={{ fontSize: '10px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--pt-text-muted)', marginBottom: '8px', padding: '0 4px' }}>
                Visible widgets
              </div>
              {WIDGET_DEFS.map(w => (
                <label key={w.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 4px', cursor: 'pointer', borderRadius: '6px' }}>
                  <input
                    type="checkbox"
                    checked={!hiddenWidgets.has(w.id)}
                    onChange={() => toggleHidden(w.id)}
                    style={{ accentColor: 'var(--pt-accent)', width: '14px', height: '14px' }}
                  />
                  <span style={{ fontSize: '13px', color: 'var(--pt-text)', fontWeight: '500' }}>{w.label}</span>
                </label>
              ))}
              <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--pt-border)', fontSize: '11px', color: 'var(--pt-text-muted)', padding: '8px 4px 0' }}>
                Drag cards to reorder.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── KPI row (fixed) ───────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px', marginBottom: '14px' }}>
        {kpis.map(kpi => (
          <div key={kpi.label} style={{
            backgroundColor: 'var(--pt-surface)',
            border: '1px solid var(--pt-border)',
            borderRadius: '14px',
            padding: '16px 18px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}>
            <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--pt-text-muted)', marginBottom: '6px' }}>
              {kpi.label}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '3px' }}>
              <span style={{ fontSize: '26px', fontWeight: '800', color: kpi.accentColor || 'var(--pt-text)', letterSpacing: '-0.8px', lineHeight: 1 }}>
                {kpi.value}
              </span>
              {kpi.delta !== undefined && <DeltaBadge delta={kpi.delta} />}
            </div>
            {kpi.sub && <div style={{ fontSize: '11px', color: 'var(--pt-text-sub)' }}>{kpi.sub}</div>}
          </div>
        ))}
      </div>

      {/* ── Draggable widgets ─────────────────────────────────── */}
      <div
        style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
        onDragOver={e => e.preventDefault()}
      >
        {widgetOrder.map(id => renderWidget(id))}
      </div>

    </div>
  );
}
