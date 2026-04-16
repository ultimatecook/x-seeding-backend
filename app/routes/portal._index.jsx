import { useState, useRef, useEffect, useCallback } from 'react';
import { useLoaderData, Link, useNavigate, useSearchParams } from 'react-router';
import prisma from '../db.server';
import { requirePortalUser } from '../utils/portal-auth.server';
import { fmtDate, fmtNum } from '../theme';
import { D, FlagImg } from '../utils/portal-theme';

// ── Predefined country list (for pills fill-in) ───────────────────────────────
const PRESET_COUNTRIES = ['Spain', 'United Kingdom', 'France', 'Italy', 'United States', 'Netherlands', 'Germany'];

// ── Loader ────────────────────────────────────────────────────────────────────
export async function loader({ request }) {
  const { shop } = await requirePortalUser(request);

  const url          = new URL(request.url);
  const daysParam    = url.searchParams.get('days');    // '30' | '180' | '365' | null (null = MTD)
  const countryParam = url.searchParams.get('country'); // country name | null

  const now  = new Date();
  const days = daysParam ? parseInt(daysParam, 10) : null;

  // Date range — default is month-to-date (April 1 → today)
  let dateStart, prevWhere;
  if (!daysParam) {
    // MTD: 1st of current month → now
    dateStart = new Date(now.getFullYear(), now.getMonth(), 1);
    // Compare to same days 1→N in previous month
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthEnd   = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate() + 1); // exclusive
    prevWhere = {
      shop,
      createdAt: { gte: prevMonthStart, lt: prevMonthEnd },
      ...(countryParam ? { influencer: { country: countryParam } } : {}),
    };
  } else {
    dateStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const prevStart = new Date(dateStart.getTime() - days * 24 * 60 * 60 * 1000);
    prevWhere = {
      shop,
      createdAt: { gte: prevStart, lt: dateStart },
      ...(countryParam ? { influencer: { country: countryParam } } : {}),
    };
  }

  // Prisma where clauses
  const seedingWhere = {
    shop,
    createdAt: { gte: dateStart },
    ...(countryParam ? { influencer: { country: countryParam } } : {}),
  };

  const [
    allSeedings,
    prevSeedings,
    recentSeedings,
    topInfluencers,
    allProductRows,
    totalInfluencers,
    allSeedingsForPills,   // unfiltered — for country pill generation
  ] = await Promise.all([
    // All seedings in range (derive status, spend, weekly chart, countries from this)
    prisma.seeding.findMany({
      where:  seedingWhere,
      select: { status: true, totalCost: true, createdAt: true,
                influencer: { select: { id: true, country: true } } },
    }),
    // Previous period (delta comparison)
    prevWhere
      ? prisma.seeding.findMany({ where: prevWhere, select: { totalCost: true } })
      : Promise.resolve(null),
    // Recent 8 seedings with full detail
    prisma.seeding.findMany({
      where:   seedingWhere,
      select:  { id: true, status: true, totalCost: true, createdAt: true,
                 influencer: { select: { id: true, handle: true, name: true, country: true } },
                 campaign:   { select: { id: true, title: true } } },
      orderBy: { createdAt: 'desc' },
      take:    8,
    }),
    // Top influencers by seedings count
    prisma.influencer.findMany({
      where:   { archived: false, ...(countryParam ? { country: countryParam } : {}) },
      orderBy: { seedings: { _count: 'desc' } },
      take:    6,
      select:  { id: true, handle: true, name: true, followers: true, country: true,
                 _count:   { select: { seedings: true } },
                 seedings: { select: { totalCost: true } } },
    }),
    // Products in range
    prisma.seedingProduct.findMany({
      where:  { seeding: seedingWhere },
      select: { cost: true, productName: true },
    }),
    // Total active influencers (absolute roster, unfiltered)
    prisma.influencer.count({ where: { archived: false } }),
    // Unfiltered seedings for country pill generation
    prisma.seeding.findMany({
      where:  { shop },
      select: { influencer: { select: { country: true } } },
      take:   5000,
    }),
  ]);

  // ── Derive metrics from allSeedings ────────────────────────────────────────
  const statusMap = {};
  for (const s of allSeedings) {
    statusMap[s.status] = (statusMap[s.status] || 0) + 1;
  }
  const totalSeedings     = allSeedings.length;
  const pendingSeedings   = statusMap['Pending']   ?? 0;
  const orderedSeedings   = statusMap['Ordered']   ?? 0;
  const shippedSeedings   = statusMap['Shipped']   ?? 0;
  const deliveredSeedings = statusMap['Delivered'] ?? 0;

  const totalSpend     = allSeedings.reduce((s, x) => s + (x.totalCost ?? 0), 0);
  const prevTotalSpend = prevSeedings ? prevSeedings.reduce((s, x) => s + (x.totalCost ?? 0), 0) : null;
  const prevCount      = prevSeedings ? prevSeedings.length : null;

  const spendDelta = prevTotalSpend !== null && prevTotalSpend > 0
    ? Math.round(((totalSpend - prevTotalSpend) / prevTotalSpend) * 100) : null;
  const countDelta = prevCount !== null && prevCount > 0
    ? Math.round(((totalSeedings - prevCount) / prevCount) * 100) : null;

  // ── Product metrics ────────────────────────────────────────────────────────
  const totalUnits = allProductRows.length;

  // ── Weekly/period buckets for dot chart ───────────────────────────────────
  // Always 12 buckets; bucket size depends on selected period.
  const NUM_BUCKETS  = 12;
  // MTD: from 1st of month to now; named periods: from N days ago to now
  const chartStart   = dateStart;
  const periodMs     = now - chartStart;
  const bucketMs     = Math.max(Math.floor(periodMs / NUM_BUCKETS), 1);

  const buckets = Array.from({ length: NUM_BUCKETS }, (_, i) => {
    const d = new Date(chartStart.getTime() + i * bucketMs);
    return { bucketStart: d, seedings: 0, spend: 0 };
  });

  for (const s of allSeedings) {
    const age = Math.floor((new Date(s.createdAt) - chartStart) / bucketMs);
    if (age >= 0 && age < NUM_BUCKETS) {
      buckets[age].seedings++;
      buckets[age].spend += s.totalCost ?? 0;
    }
  }

  // ── Country data ───────────────────────────────────────────────────────────
  const countryMap = {};
  for (const s of allSeedings) {
    const c = s.influencer?.country || 'Unknown';
    if (!countryMap[c]) countryMap[c] = { seedings: 0, spend: 0, influencers: new Set() };
    countryMap[c].seedings++;
    countryMap[c].spend += s.totalCost ?? 0;
    if (s.influencer?.id) countryMap[c].influencers.add(s.influencer.id);
  }
  const countryData = Object.entries(countryMap)
    .map(([country, d]) => ({ country, seedings: d.seedings, spend: d.spend, influencers: d.influencers.size }))
    .sort((a, b) => b.seedings - a.seedings)
    .slice(0, 8);

  // ── Country pills (unfiltered) ─────────────────────────────────────────────
  const pillCountMap = {};
  for (const s of allSeedingsForPills) {
    const c = s.influencer?.country;
    if (c && c !== 'Unknown') pillCountMap[c] = (pillCountMap[c] || 0) + 1;
  }
  const topDataCountries = Object.entries(pillCountMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([c]) => c);

  // Fill remaining slots from preset list (no duplicates)
  const countryPills = [...topDataCountries];
  for (const c of PRESET_COUNTRIES) {
    if (countryPills.length >= 5) break;
    if (!countryPills.includes(c)) countryPills.push(c);
  }

  const topInfluencersData = topInfluencers.map(inf => ({
    ...inf,
    totalSpend: inf.seedings.reduce((s, x) => s + (x.totalCost ?? 0), 0),
  }));

  // Human-readable range label, e.g. "Apr 1–16"
  const monthName  = dateStart.toLocaleDateString('en-GB', { month: 'short' });
  const rangeLabel = !daysParam
    ? `${monthName} 1–${now.getDate()}`
    : daysParam === '30'  ? 'last 30 days'
    : daysParam === '180' ? 'last 6 months'
    :                       'last year';

  return {
    totalSeedings, pendingSeedings, orderedSeedings,
    shippedSeedings, deliveredSeedings,
    totalInfluencers, recentSeedings, countryData,
    topInfluencers: topInfluencersData,
    totalSpend, totalUnits,
    spendDelta, countDelta,
    countryPills,
    activeDays:    daysParam ?? null,
    activeCountry: countryParam ?? null,
    activeSeedings: orderedSeedings + shippedSeedings,
    rangeLabel,
    currentMonthShort: now.toLocaleDateString('en-GB', { month: 'short' }), // e.g. "Apr"
    weeks: buckets.map(b => ({
      label:    fmtBucketLabel(b.bucketStart, days),
      seedings: b.seedings,
      spend:    b.spend,
    })),
  };
}

function fmtBucketLabel(d, days) {
  if (!days || days <= 30) return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  if (days <= 180)         return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return d.toLocaleDateString('en-GB', { month: 'short' });
}

function fmtFollowers(n) {
  if (!n) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K`;
  return String(n);
}

// ── Status dots only (no pill chrome) ────────────────────────────────────────
const STATUS_DOT = {
  Pending:   D.statusPending.dot,
  Ordered:   D.statusOrdered.dot,
  Shipped:   D.statusShipped.dot,
  Delivered: D.statusDelivered.dot,
};

function StatusDot({ status }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      fontSize: '11px', fontWeight: '600', color: 'var(--pt-text-sub)', whiteSpace: 'nowrap',
    }}>
      <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: STATUS_DOT[status] || 'var(--pt-text-muted)', flexShrink: 0, display: 'inline-block' }} />
      {status}
    </span>
  );
}

// ── Delta inline ──────────────────────────────────────────────────────────────
function Delta({ delta }) {
  if (delta === null || delta === undefined) return null;
  const up = delta >= 0;
  return (
    <span style={{
      fontSize: '11px', fontWeight: '600',
      color: up ? '#15803D' : '#B91C1C',
    }}>
      {up ? '↑' : '↓'}{Math.abs(delta)}%
    </span>
  );
}

// ── Dot-matrix chart ──────────────────────────────────────────────────────────
function DotChart({ weeks }) {
  const maxSeedings = Math.max(...weeks.map(w => w.seedings), 1);
  const peakIdx     = weeks.reduce((best, w, i) => w.seedings > weeks[best].seedings ? i : best, 0);
  const MAX_DOTS    = 9;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: '88px' }}>
        {weeks.map((w, i) => {
          const filled   = maxSeedings > 0 ? Math.max(Math.round((w.seedings / maxSeedings) * MAX_DOTS), w.seedings > 0 ? 1 : 0) : 0;
          const isPeak   = i === peakIdx && maxSeedings > 0;
          const isRecent = i >= weeks.length - 4;
          return (
            <div key={i} title={`${w.label}: ${w.seedings} seedings`}
              style={{ flex: 1, display: 'flex', flexDirection: 'column-reverse', alignItems: 'center', gap: '4px', height: '100%', justifyContent: 'flex-start' }}>
              {Array.from({ length: MAX_DOTS }, (_, di) => (
                <div key={di} style={{
                  width: '100%', maxWidth: '11px', height: '8px', borderRadius: '3px', flexShrink: 0,
                  backgroundColor: di < filled
                    ? isPeak   ? '#7C6FF7'
                    : isRecent ? '#A78BFA'
                    :            '#DDD9FC'
                    : 'var(--pt-surface-high)',
                }} />
              ))}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: '4px', marginTop: '8px' }}>
        {weeks.map((w, i) => (
          <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: '9px', color: 'var(--pt-text-muted)', overflow: 'hidden', whiteSpace: 'nowrap' }}>
            {i % 3 === 0 ? w.label : ''}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Section label ─────────────────────────────────────────────────────────────
function Label({ children }) {
  return (
    <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--pt-text-muted)', marginBottom: '18px' }}>
      {children}
    </div>
  );
}

// ── Thin rule ─────────────────────────────────────────────────────────────────
function Rule({ my = 40 }) {
  return <div style={{ borderTop: '1px solid var(--pt-border)', margin: `${my}px 0` }} />;
}

// ── Band / section definitions ────────────────────────────────────────────────
// Bands are the draggable rows. Sections are the individual hideable pieces.
const DEFAULT_BAND_ORDER = ['stats', 'midrow', 'botrow'];

const SECTION_DEFS = [
  { id: 'stats',       label: 'Stats',          band: 'stats'   },
  { id: 'pipeline',    label: 'Pipeline',        band: 'midrow'  },
  { id: 'recent',      label: 'Recent Seedings', band: 'midrow'  },
  { id: 'countries',   label: 'Countries',       band: 'botrow'  },
  { id: 'influencers', label: 'Top Influencers', band: 'botrow'  },
];

// ── Draggable band wrapper ────────────────────────────────────────────────────
function Band({ id, editMode, isDragOver, onDragStart, onDragOver, onDrop, onDragEnd, children }) {
  return (
    <div
      draggable={editMode}
      onDragStart={editMode ? e => { e.stopPropagation(); onDragStart(e, id); } : undefined}
      onDragOver={editMode ? e => { e.preventDefault(); onDragOver(e, id); } : undefined}
      onDrop={editMode ? e => { e.preventDefault(); onDrop(e, id); } : undefined}
      onDragEnd={editMode ? onDragEnd : undefined}
      style={{
        position: 'relative',
        cursor: editMode ? 'grab' : 'default',
        borderRadius: '8px',
        outline: editMode && isDragOver ? '2px solid var(--pt-accent)' : 'none',
        outlineOffset: '6px',
        transition: 'outline 0.1s',
      }}
    >
      {editMode && (
        <div style={{
          position: 'absolute', top: '-18px', left: '50%', transform: 'translateX(-50%)',
          fontSize: '13px', color: 'var(--pt-text-muted)', userSelect: 'none',
          opacity: 0.45, letterSpacing: '4px',
        }}>
          · · ·
        </div>
      )}
      {children}
    </div>
  );
}

// TIME_OPTIONS is built dynamically in the component (first pill uses month name from loader)

// ── Dashboard ─────────────────────────────────────────────────────────────────
export default function PortalDashboard() {
  const {
    totalSeedings, pendingSeedings, orderedSeedings,
    shippedSeedings, deliveredSeedings,
    totalInfluencers, recentSeedings, countryData,
    topInfluencers, totalSpend, totalUnits,
    spendDelta, countDelta,
    countryPills, activeDays, activeCountry,
    activeSeedings, weeks, rangeLabel, currentMonthShort,
  } = useLoaderData();

  // Time filter pill options — first pill is always the current month (MTD default)
  const TIME_OPTIONS = [
    { label: currentMonthShort, value: null  },  // MTD — default state
    { label: '30d',             value: '30'  },
    { label: '6mo',             value: '180' },
    { label: '1yr',             value: '365' },
  ];

  const navigate     = useNavigate();
  const [searchParams] = useSearchParams();

  const completionRate    = totalSeedings > 0 ? Math.round((deliveredSeedings / totalSeedings) * 100) : 0;
  const chartTotal        = weeks.reduce((s, w) => s + w.seedings, 0);
  const peakWeek          = weeks.reduce((best, w) => w.seedings > best.seedings ? w : best, weeks[0] ?? { label: '', seedings: 0 });

  const chartLabel = rangeLabel;

  const pipeline = [
    { label: 'Pending',   count: pendingSeedings,   color: D.statusPending.dot   },
    { label: 'Ordered',   count: orderedSeedings,   color: D.statusOrdered.dot   },
    { label: 'Shipped',   count: shippedSeedings,   color: D.statusShipped.dot   },
    { label: 'Delivered', count: deliveredSeedings, color: D.statusDelivered.dot },
  ];

  function buildUrl(newDays, newCountry) {
    const p = new URLSearchParams(searchParams);
    if (newDays    === null) p.delete('days');    else p.set('days', newDays);
    if (newCountry === null) p.delete('country'); else p.set('country', newCountry);
    const qs = p.toString();
    return `/portal${qs ? `?${qs}` : ''}`;
  }
  const toggleDays    = val  => navigate(buildUrl(val === activeDays ? null : val, activeCountry));
  const toggleCountry = name => navigate(buildUrl(activeDays, activeCountry === name ? null : name));

  // ── Edit mode: band order + section visibility ──────────────────────────────
  const [editMode,     setEditMode]     = useState(false);
  const [bandOrder,    setBandOrder]    = useState(DEFAULT_BAND_ORDER);
  const [hiddenSet,    setHiddenSet]    = useState(() => new Set());

  useEffect(() => {
    try {
      const o = localStorage.getItem('dash-order-v2');
      const h = localStorage.getItem('dash-hidden-v2');
      if (o) setBandOrder(JSON.parse(o));
      if (h) setHiddenSet(new Set(JSON.parse(h)));
    } catch {}
  }, []);

  const toggleSection = useCallback((id) => {
    setHiddenSet(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      localStorage.setItem('dash-hidden-v2', JSON.stringify([...next]));
      return next;
    });
  }, []);

  // ── Drag-and-drop (only active in editMode) ─────────────────────────────────
  const draggingId = useRef(null);
  const [dragOver, setDragOver] = useState(null);

  const handleDragStart = useCallback((e, id) => {
    draggingId.current = id;
    e.dataTransfer.effectAllowed = 'move';
  }, []);
  const handleDragOver = useCallback((e, id) => {
    e.preventDefault();
    setDragOver(id);
  }, []);
  const handleDrop = useCallback((e, targetId) => {
    e.preventDefault();
    setDragOver(null);
    const fromId = draggingId.current;
    if (!fromId || fromId === targetId) return;
    setBandOrder(prev => {
      const next = [...prev];
      const fi = next.indexOf(fromId), ti = next.indexOf(targetId);
      next.splice(fi, 1);
      next.splice(ti, 0, fromId);
      localStorage.setItem('dash-order-v2', JSON.stringify(next));
      return next;
    });
    draggingId.current = null;
  }, []);
  const handleDragEnd = useCallback(() => {
    setDragOver(null);
    draggingId.current = null;
  }, []);

  // Convenience: is a given section visible?
  const vis = (id) => !hiddenSet.has(id);

  // pill button style
  const pill = (active) => ({
    display: 'inline-flex', alignItems: 'center', gap: '5px',
    padding: '5px 12px', borderRadius: '99px', cursor: 'pointer',
    fontSize: '12px', fontWeight: '600', border: 'none',
    transition: 'all 0.12s',
    backgroundColor: active ? '#7C6FF7'               : 'transparent',
    color:           active ? '#fff'                  : 'var(--pt-text-muted)',
    boxShadow:       active ? '0 1px 4px rgba(124,111,247,0.3)' : 'none',
  });

  // ── Band content renderers ─────────────────────────────────────────────────
  const renderStats = () => (
    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1px 1fr 1px 1fr 1px 1fr', alignItems: 'start', gap: '0' }}>
      <div style={{ paddingRight: '36px' }}>
        <Label>Retail Value Seeded</Label>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
          <span style={{ fontSize: '38px', fontWeight: '800', letterSpacing: '-1.5px', color: 'var(--pt-text)', lineHeight: 1 }}>
            €{fmtNum(totalSpend)}
          </span>
          <Delta delta={spendDelta} />
        </div>
      </div>
      <div style={{ backgroundColor: 'var(--pt-border)', alignSelf: 'stretch' }} />
      <div style={{ padding: '0 32px' }}>
        <Label>Units Sent</Label>
        <span style={{ fontSize: '26px', fontWeight: '800', letterSpacing: '-0.8px', color: 'var(--pt-text)', lineHeight: 1 }}>{totalUnits}</span>
      </div>
      <div style={{ backgroundColor: 'var(--pt-border)', alignSelf: 'stretch' }} />
      <div style={{ padding: '0 32px' }}>
        <Label>In Transit</Label>
        <span style={{ fontSize: '26px', fontWeight: '800', letterSpacing: '-0.8px', color: 'var(--pt-text)', lineHeight: 1 }}>{activeSeedings}</span>
      </div>
      <div style={{ backgroundColor: 'var(--pt-border)', alignSelf: 'stretch' }} />
      <div style={{ paddingLeft: '32px' }}>
        <Label>Influencers</Label>
        <span style={{ fontSize: '26px', fontWeight: '800', letterSpacing: '-0.8px', color: 'var(--pt-text)', lineHeight: 1 }}>{totalInfluencers}</span>
      </div>
    </div>
  );

  const renderPipeline = () => (
    <div>
      <Label>Pipeline</Label>
      {totalSeedings === 0 ? (
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--pt-text-muted)' }}>No seedings yet.</p>
      ) : (
        <>
          <div style={{ display: 'flex', height: '3px', borderRadius: '99px', overflow: 'hidden', backgroundColor: 'var(--pt-surface-high)', marginBottom: '20px' }}>
            {pipeline.filter(s => s.count > 0).map(s => (
              <div key={s.label} title={`${s.label}: ${s.count}`} style={{ width: `${(s.count / totalSeedings) * 100}%`, backgroundColor: s.color }} />
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {pipeline.map(s => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: s.color, flexShrink: 0 }} />
                  <span style={{ fontSize: '12px', color: 'var(--pt-text-sub)' }}>{s.label}</span>
                </div>
                <span style={{ fontSize: '14px', fontWeight: '700', color: 'var(--pt-text)' }}>{s.count}</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--pt-text-muted)', marginTop: '16px' }}>{completionRate}% delivered</div>
        </>
      )}
    </div>
  );

  const renderRecent = () => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
        <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--pt-text-muted)' }}>Recent Seedings</div>
        <Link to="/portal/seedings" style={{ fontSize: '11px', color: 'var(--pt-accent)', fontWeight: '600', textDecoration: 'none' }}>View all →</Link>
      </div>
      {recentSeedings.length === 0 ? (
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--pt-text-muted)' }}>No seedings yet.</p>
      ) : (
        <div>
          {recentSeedings.slice(0, 6).map((s, i) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderTop: i === 0 ? 'none' : '1px solid var(--pt-border-light)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                {s.influencer?.country && <FlagImg country={s.influencer.country} size={13} />}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--pt-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.influencer?.name || `@${s.influencer?.handle}`}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--pt-text-muted)', marginTop: '1px' }}>
                    {s.campaign?.title || '—'} · {fmtDate(s.createdAt, 'short')}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0, marginLeft: '16px' }}>
                <StatusDot status={s.status} />
                <span style={{ fontSize: '13px', fontWeight: '700', color: 'var(--pt-text)', minWidth: '52px', textAlign: 'right' }}>
                  {s.totalCost ? `€${fmtNum(s.totalCost)}` : '—'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderCountries = () => (
    <div>
      <Label>Top Countries</Label>
      {countryData.length === 0 ? (
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--pt-text-muted)' }}>No data yet.</p>
      ) : (
        <div>
          {countryData.slice(0, 5).map((d, i) => (
            <div key={d.country} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderTop: i === 0 ? 'none' : '1px solid var(--pt-border-light)' }}>
              <FlagImg country={d.country} size={17} />
              <span style={{ flex: 1, fontSize: '13px', fontWeight: '500', color: 'var(--pt-text)' }}>{d.country}</span>
              <span style={{ fontSize: '11px', color: 'var(--pt-text-muted)' }}>{d.seedings} seedings</span>
              <span style={{ fontSize: '13px', fontWeight: '700', color: 'var(--pt-text)', minWidth: '56px', textAlign: 'right' }}>€{fmtNum(d.spend)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderInfluencers = () => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
        <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--pt-text-muted)' }}>Top Influencers</div>
        <Link to="/portal/influencers" style={{ fontSize: '11px', color: 'var(--pt-accent)', fontWeight: '600', textDecoration: 'none' }}>View all →</Link>
      </div>
      {topInfluencers.length === 0 ? (
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--pt-text-muted)' }}>No influencers yet.</p>
      ) : (
        <div>
          {topInfluencers.map((inf, i) => (
            <Link key={inf.id} to={`/portal/influencers/${inf.id}`} style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderTop: i === 0 ? 'none' : '1px solid var(--pt-border-light)' }}>
              <span style={{ fontSize: '10px', fontWeight: '700', color: 'var(--pt-text-muted)', width: '14px', textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--pt-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inf.name || `@${inf.handle}`}</div>
                <div style={{ fontSize: '11px', color: 'var(--pt-text-muted)', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '1px' }}>
                  <FlagImg country={inf.country} size={11} />
                  {inf.country || '—'} · {fmtFollowers(inf.followers)}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--pt-text)' }}>{inf._count.seedings}</div>
                <div style={{ fontSize: '11px', color: 'var(--pt-text-muted)' }}>seedings</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0, minWidth: '52px' }}>
                <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--pt-accent)' }}>€{fmtNum(inf.totalSpend)}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );

  // ── Band renderer ──────────────────────────────────────────────────────────
  const bandProps = (id) => ({
    id, editMode,
    isDragOver: dragOver === id,
    onDragStart: handleDragStart, onDragOver: handleDragOver,
    onDrop: handleDrop, onDragEnd: handleDragEnd,
  });

  const renderBand = (id) => {
    if (id === 'stats') {
      if (!vis('stats')) return null;
      return (
        <Band key={id} {...bandProps(id)}>
          {renderStats()}
        </Band>
      );
    }

    if (id === 'midrow') {
      const showP = vis('pipeline'), showR = vis('recent');
      if (!showP && !showR) return null;
      return (
        <Band key={id} {...bandProps(id)}>
          <div style={{ display: 'grid', gridTemplateColumns: showP && showR ? '220px 1fr' : '1fr', gap: '0 60px', alignItems: 'start' }}>
            {showP && renderPipeline()}
            {showR && renderRecent()}
          </div>
        </Band>
      );
    }

    if (id === 'botrow') {
      const showC = vis('countries') && !activeCountry;
      const showI = vis('influencers');
      if (!showC && !showI) return null;
      return (
        <Band key={id} {...bandProps(id)}>
          <div style={{ display: 'grid', gridTemplateColumns: showC && showI ? '1fr 1fr' : '1fr', gap: '60px', alignItems: 'start' }}>
            {showC && renderCountries()}
            {showI && renderInfluencers()}
          </div>
        </Band>
      );
    }

    return null;
  };

  // Compute which bands are visible (for inserting rules only between visible bands)
  const visibleBands = bandOrder.filter(id => {
    if (id === 'stats')  return vis('stats');
    if (id === 'midrow') return vis('pipeline') || vis('recent');
    if (id === 'botrow') return (vis('countries') && !activeCountry) || vis('influencers');
    return false;
  });

  return (
    <div style={{ paddingBottom: '60px' }}>

      {/* ── Header ───────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '36px' }}>
        <h1 style={{ margin: 0, fontSize: '18px', fontWeight: '700', color: 'var(--pt-text)', letterSpacing: '-0.3px' }}>Overview</h1>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Time filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px', backgroundColor: 'var(--pt-surface-high)', borderRadius: '99px', padding: '3px', border: '1px solid var(--pt-border)' }}>
            {TIME_OPTIONS.map(opt => (
              <button key={opt.value ?? 'mtd'} onClick={() => toggleDays(opt.value)} style={pill(activeDays === opt.value)}>
                {opt.label}
              </button>
            ))}
            {activeDays && (
              <button onClick={() => navigate(buildUrl(null, activeCountry))} style={{ ...pill(false), color: 'var(--pt-text-muted)', padding: '5px 9px' }}>✕</button>
            )}
          </div>

          {/* Country filter */}
          {countryPills.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '2px', backgroundColor: 'var(--pt-surface-high)', borderRadius: '99px', padding: '3px', border: '1px solid var(--pt-border)' }}>
              {countryPills.map(country => (
                <button key={country} onClick={() => toggleCountry(country)} style={{ ...pill(activeCountry === country), gap: '5px' }}>
                  <FlagImg country={country} size={14} />
                  <span>{country.split(' ')[0]}</span>
                </button>
              ))}
              {activeCountry && (
                <button onClick={() => navigate(buildUrl(activeDays, null))} style={{ ...pill(false), color: 'var(--pt-text-muted)', padding: '5px 9px' }}>✕</button>
              )}
            </div>
          )}

          {/* Edit layout toggle */}
          <button
            onClick={() => setEditMode(v => !v)}
            style={{
              padding: '5px 12px', borderRadius: '8px', border: '1px solid var(--pt-border)',
              backgroundColor: editMode ? 'var(--pt-accent-light)' : 'transparent',
              color: editMode ? 'var(--pt-accent)' : 'var(--pt-text-muted)',
              cursor: 'pointer', fontSize: '12px', fontWeight: '600',
            }}
          >
            {editMode ? 'Done' : 'Edit'}
          </button>
        </div>
      </div>

      {/* ── Edit panel ────────────────────────────────────────── */}
      {editMode && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap',
          backgroundColor: 'var(--pt-surface)', border: '1px solid var(--pt-border)',
          borderRadius: '10px', padding: '12px 16px', marginBottom: '28px',
        }}>
          <span style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--pt-text-muted)', flexShrink: 0 }}>
            Sections
          </span>
          {SECTION_DEFS.map(s => (
            <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={vis(s.id)}
                onChange={() => toggleSection(s.id)}
                style={{ accentColor: 'var(--pt-accent)', width: '13px', height: '13px' }}
              />
              <span style={{ fontSize: '12px', color: vis(s.id) ? 'var(--pt-text)' : 'var(--pt-text-muted)', fontWeight: '500' }}>
                {s.label}
              </span>
            </label>
          ))}
          <span style={{ fontSize: '11px', color: 'var(--pt-text-muted)', marginLeft: 'auto' }}>
            Drag rows to reorder
          </span>
        </div>
      )}

      {/* ── Hero: big number + chart (always visible) ─────────── */}
      <div style={{ marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '14px', marginBottom: '4px' }}>
          <span style={{ fontSize: '56px', fontWeight: '800', letterSpacing: '-2.5px', lineHeight: 1, color: 'var(--pt-text)' }}>
            {chartTotal}
          </span>
          <span style={{ fontSize: '16px', color: 'var(--pt-text-muted)', fontWeight: '400' }}>seedings</span>
          <Delta delta={countDelta} />
        </div>
        <div style={{ fontSize: '13px', color: 'var(--pt-text-muted)', marginBottom: '24px' }}>
          {chartLabel}
          {activeCountry && <span> · {activeCountry}</span>}
          {peakWeek.seedings > 0 && (
            <span> · peak <strong style={{ color: 'var(--pt-text-sub)', fontWeight: '600' }}>{peakWeek.label}</strong></span>
          )}
        </div>
        <DotChart weeks={weeks} />
      </div>

      {/* ── Draggable bands ───────────────────────────────────── */}
      {visibleBands.length > 0 && (
        <div style={{ marginTop: editMode ? '28px' : '0' }}>
          {bandOrder.map((id, idx) => {
            const content = renderBand(id);
            if (!content) return null;
            const isFirstVisible = visibleBands[0] === id;
            return (
              <div key={id}>
                <Rule my={36} />
                {editMode && !isFirstVisible && <div style={{ height: '8px' }} />}
                {content}
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
