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
    dateStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthEnd   = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate() + 1);
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
    allSeedingsForPills,
  ] = await Promise.all([
    prisma.seeding.findMany({
      where:  seedingWhere,
      select: { status: true, totalCost: true, createdAt: true,
                influencer: { select: { id: true, country: true } } },
    }),
    prevWhere
      ? prisma.seeding.findMany({ where: prevWhere, select: { totalCost: true } })
      : Promise.resolve(null),
    prisma.seeding.findMany({
      where:   seedingWhere,
      select:  { id: true, status: true, totalCost: true, createdAt: true,
                 influencer: { select: { id: true, handle: true, name: true, country: true } },
                 campaign:   { select: { id: true, title: true } } },
      orderBy: { createdAt: 'desc' },
      take:    8,
    }),
    prisma.influencer.findMany({
      where:   { archived: false, ...(countryParam ? { country: countryParam } : {}) },
      orderBy: { seedings: { _count: 'desc' } },
      take:    6,
      select:  { id: true, handle: true, name: true, followers: true, country: true,
                 _count:   { select: { seedings: true } },
                 seedings: { select: { totalCost: true } } },
    }),
    prisma.seedingProduct.findMany({
      where:  { seeding: seedingWhere },
      select: { cost: true, productName: true },
    }),
    prisma.influencer.count({ where: { archived: false } }),
    prisma.seeding.findMany({
      where:  { shop },
      select: { influencer: { select: { country: true } } },
      take:   5000,
    }),
  ]);

  // ── Metrics ────────────────────────────────────────────────────────────────
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

  const totalUnits = allProductRows.length;

  // ── Per-day chart data ─────────────────────────────────────────────────────
  const DAY_MS    = 24 * 60 * 60 * 1000;
  const totalDays = Math.min(Math.floor((now - dateStart) / DAY_MS) + 1, 365);

  const dayBuckets = Array.from({ length: totalDays }, (_, i) => ({
    date:     new Date(dateStart.getTime() + i * DAY_MS),
    seedings: 0,
  }));

  for (const s of allSeedings) {
    const age = Math.floor((new Date(s.createdAt) - dateStart) / DAY_MS);
    if (age >= 0 && age < totalDays) dayBuckets[age].seedings++;
  }

  const chartDays = dayBuckets.map(b => ({
    label:    b.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    seedings: b.seedings,
  }));

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
    .sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c]) => c);

  const countryPills = [...topDataCountries];
  for (const c of PRESET_COUNTRIES) {
    if (countryPills.length >= 5) break;
    if (!countryPills.includes(c)) countryPills.push(c);
  }

  const topInfluencersData = topInfluencers.map(inf => ({
    ...inf,
    totalSpend: inf.seedings.reduce((s, x) => s + (x.totalCost ?? 0), 0),
  }));

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
    currentMonthShort: now.toLocaleDateString('en-GB', { month: 'short' }),
    chartDays,
  };
}

function fmtFollowers(n) {
  if (!n) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K`;
  return String(n);
}

// ── Status dots ───────────────────────────────────────────────────────────────
const STATUS_DOT = {
  Pending:   D.statusPending.dot,
  Ordered:   D.statusOrdered.dot,
  Shipped:   D.statusShipped.dot,
  Delivered: D.statusDelivered.dot,
};

function StatusDot({ status }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px',
      fontSize: '11px', fontWeight: '600', color: 'var(--pt-text-sub)', whiteSpace: 'nowrap' }}>
      <span style={{ width: '5px', height: '5px', borderRadius: '50%',
        backgroundColor: STATUS_DOT[status] || 'var(--pt-text-muted)', flexShrink: 0, display: 'inline-block' }} />
      {status}
    </span>
  );
}

// ── Delta inline ──────────────────────────────────────────────────────────────
function Delta({ delta }) {
  if (delta === null || delta === undefined) return null;
  const up = delta >= 0;
  return (
    <span style={{ fontSize: '11px', fontWeight: '600', color: up ? '#15803D' : '#B91C1C' }}>
      {up ? '↑' : '↓'}{Math.abs(delta)}%
    </span>
  );
}

// ── Stat card icons ───────────────────────────────────────────────────────────
function IconEuro() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9"/>
      <path d="M14.5 8.5a4 4 0 0 0-6 3.5v0a4 4 0 0 0 6 3.5"/>
      <line x1="8" y1="11" x2="14" y2="11"/>
      <line x1="8" y1="13" x2="14" y2="13"/>
    </svg>
  );
}
function IconBox() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
      <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
      <line x1="12" y1="22.08" x2="12" y2="12"/>
    </svg>
  );
}
function IconTruck() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="3" width="15" height="13" rx="1"/>
      <path d="M16 8h4l3 5v3h-7V8z"/>
      <circle cx="5.5" cy="18.5" r="2.5"/>
      <circle cx="18.5" cy="18.5" r="2.5"/>
    </svg>
  );
}
function IconUsers() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, delta, icon, iconColor, iconBg }) {
  return (
    <div style={{
      border: '1px solid var(--pt-border)',
      borderRadius: '14px',
      padding: '20px 20px 18px',
      backgroundColor: 'var(--pt-surface)',
      position: 'relative',
    }}>
      {/* Icon badge */}
      <div style={{
        position: 'absolute', top: '16px', right: '16px',
        width: '34px', height: '34px', borderRadius: '9px',
        backgroundColor: iconBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: iconColor,
      }}>
        {icon}
      </div>

      {/* Label */}
      <div style={{ fontSize: '12px', fontWeight: '500', color: 'var(--pt-text-muted)', marginBottom: '14px' }}>
        {label}
      </div>

      {/* Value + delta */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
        <span style={{ fontSize: '28px', fontWeight: '800', letterSpacing: '-1px', color: 'var(--pt-text)', lineHeight: 1 }}>
          {value}
        </span>
        {delta != null && <Delta delta={delta} />}
      </div>
    </div>
  );
}

// ── Interactive line chart ─────────────────────────────────────────────────────
function LineChart({ days }) {
  const [hover, setHover] = useState(null); // { idx }
  const [cw,    setCw]    = useState(800);  // measured container width
  const wrapRef           = useRef(null);

  // Measure actual container width so the chart fills it perfectly
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      const w = Math.floor(entry.contentRect.width);
      if (w > 0) setCw(w);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const W   = cw;
  const H   = 130;
  const PAD = { top: 10, right: 14, bottom: 28, left: 28 };
  const CW  = Math.max(W - PAD.left - PAD.right, 1);
  const CH  = H - PAD.top - PAD.bottom;

  const maxVal = Math.max(...days.map(d => d.seedings), 1);
  const yMax   = maxVal <= 1 ? 2 : Math.ceil(maxVal * 1.15);

  const xScale = (i) =>
    days.length <= 1 ? PAD.left + CW / 2 : PAD.left + (i / (days.length - 1)) * CW;
  const yScale = (v) => PAD.top + CH - (v / yMax) * CH;

  const pts   = days.map((d, i) => [xScale(i), yScale(d.seedings)]);
  const pathD = pts.length < 2 ? '' :
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const areaD = pts.length < 2 ? '' :
    `${pathD} L${pts.at(-1)[0].toFixed(1)},${(PAD.top + CH).toFixed(1)} L${pts[0][0].toFixed(1)},${(PAD.top + CH).toFixed(1)} Z`;

  const gridVals   = [0, Math.round(yMax / 2), yMax];
  const labelEvery = Math.max(1, Math.ceil(days.length / 8));

  // Direct pixel math — no scaling factor needed since viewBox matches rendered size
  const handleMouseMove = useCallback((e) => {
    const el = wrapRef.current;
    if (!el) return;
    const rect  = el.getBoundingClientRect();
    const relX  = e.clientX - rect.left - PAD.left;
    const idx   = Math.max(0, Math.min(days.length - 1, Math.round((relX / CW) * (days.length - 1))));
    setHover({ idx });
  }, [days.length, CW]);

  const hIdx  = hover?.idx ?? null;
  const hData = hIdx !== null ? days[hIdx] : null;
  const hX    = hIdx !== null ? xScale(hIdx) : null;
  const hY    = hIdx !== null ? yScale(days[hIdx].seedings) : null;
  const ttLeft = hX !== null ? Math.max(4, Math.min(hX - 55, W - 134)) : 0;

  return (
    <div ref={wrapRef} style={{ position: 'relative', userSelect: 'none' }}>
      <svg
        width={W} height={H}
        viewBox={`0 0 ${W} ${H}`}
        style={{ display: 'block', width: '100%', overflow: 'visible' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="lcGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#7C6FF7" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#7C6FF7" stopOpacity="0"   />
          </linearGradient>
        </defs>

        {/* Gridlines + Y labels */}
        {gridVals.map(v => (
          <g key={v}>
            <line x1={PAD.left} y1={yScale(v)} x2={PAD.left + CW} y2={yScale(v)}
              stroke="var(--pt-border)" strokeWidth="1" />
            <text x={PAD.left - 6} y={yScale(v) + 3.5} textAnchor="end"
              fontSize="10" fill="var(--pt-text-muted)">{v}</text>
          </g>
        ))}

        {/* Area fill */}
        {areaD && <path d={areaD} fill="url(#lcGrad)" />}

        {/* Line */}
        {pathD && (
          <path d={pathD} fill="none" stroke="#7C6FF7" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" />
        )}

        {/* X labels */}
        {days.map((d, i) => {
          if (i % labelEvery !== 0 && i !== days.length - 1) return null;
          return (
            <text key={i} x={xScale(i)} y={H - 4} textAnchor="middle"
              fontSize="10" fill="var(--pt-text-muted)">{d.label}</text>
          );
        })}

        {/* Hover crosshair + dot */}
        {hIdx !== null && (
          <>
            <line x1={hX} y1={PAD.top} x2={hX} y2={PAD.top + CH}
              stroke="#94A3B8" strokeWidth="1" opacity="0.6" />
            <circle cx={hX} cy={hY} r="4.5"
              fill="#7C6FF7" stroke="white" strokeWidth="2" />
          </>
        )}
      </svg>

      {/* Floating tooltip */}
      {hIdx !== null && hData && (
        <div style={{
          position:        'absolute',
          left:            `${ttLeft}px`,
          top:             `${Math.max(0, (hY ?? 0) - 74)}px`,
          backgroundColor: 'var(--pt-surface)',
          border:          '1px solid var(--pt-border)',
          borderRadius:    '10px',
          padding:         '8px 14px',
          pointerEvents:   'none',
          whiteSpace:      'nowrap',
          boxShadow:       '0 4px 16px rgba(0,0,0,0.08)',
          zIndex:          20,
          minWidth:        '110px',
        }}>
          <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--pt-text)', marginBottom: '4px' }}>
            {hData.label}
          </div>
          <div style={{ fontSize: '12px', fontWeight: '600', color: '#7C6FF7' }}>
            {hData.seedings} seedings
          </div>
        </div>
      )}
    </div>
  );
}

// ── Section label ─────────────────────────────────────────────────────────────
function Label({ children }) {
  return (
    <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1px',
      color: 'var(--pt-text-muted)', marginBottom: '18px' }}>
      {children}
    </div>
  );
}

// ── Thin rule ─────────────────────────────────────────────────────────────────
function Rule({ my = 40 }) {
  return <div style={{ borderTop: '1px solid var(--pt-border)', margin: `${my}px 0` }} />;
}

// ── Band / section definitions ────────────────────────────────────────────────
const DEFAULT_BAND_ORDER = ['stats', 'midrow', 'botrow'];

const SECTION_DEFS = [
  { id: 'stats',       label: 'Stats',          band: 'stats'  },
  { id: 'pipeline',    label: 'Pipeline',        band: 'midrow' },
  { id: 'recent',      label: 'Recent Seedings', band: 'midrow' },
  { id: 'countries',   label: 'Countries',       band: 'botrow' },
  { id: 'influencers', label: 'Top Influencers', band: 'botrow' },
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

// ── Dashboard ─────────────────────────────────────────────────────────────────
export default function PortalDashboard() {
  const {
    totalSeedings, pendingSeedings, orderedSeedings,
    shippedSeedings, deliveredSeedings,
    totalInfluencers, recentSeedings, countryData,
    topInfluencers, totalSpend, totalUnits,
    spendDelta, countDelta,
    countryPills, activeDays, activeCountry,
    activeSeedings, chartDays, rangeLabel, currentMonthShort,
  } = useLoaderData();

  const TIME_OPTIONS = [
    { label: currentMonthShort, value: null  },
    { label: '30d',             value: '30'  },
    { label: '6mo',             value: '180' },
    { label: '1yr',             value: '365' },
  ];

  const navigate       = useNavigate();
  const [searchParams] = useSearchParams();

  const completionRate = totalSeedings > 0 ? Math.round((deliveredSeedings / totalSeedings) * 100) : 0;
  const chartTotal     = chartDays.reduce((s, d) => s + d.seedings, 0);
  const peakDay        = chartDays.reduce((best, d) => d.seedings > best.seedings ? d : best, chartDays[0] ?? { label: '', seedings: 0 });

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

  // ── Edit mode ──────────────────────────────────────────────────────────────
  const [editMode,  setEditMode]  = useState(false);
  const [bandOrder, setBandOrder] = useState(DEFAULT_BAND_ORDER);
  const [hiddenSet, setHiddenSet] = useState(() => new Set());

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

  // ── Drag-and-drop ──────────────────────────────────────────────────────────
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

  const vis = (id) => !hiddenSet.has(id);

  const pill = (active) => ({
    display: 'inline-flex', alignItems: 'center', gap: '5px',
    padding: '5px 12px', borderRadius: '99px', cursor: 'pointer',
    fontSize: '12px', fontWeight: '600', border: 'none',
    transition: 'all 0.12s',
    backgroundColor: active ? '#7C6FF7'                       : 'transparent',
    color:           active ? '#fff'                          : 'var(--pt-text-muted)',
    boxShadow:       active ? '0 1px 4px rgba(124,111,247,0.3)' : 'none',
  });

  // ── Section renderers ──────────────────────────────────────────────────────
  const renderStats = () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
      <StatCard
        label="Retail Value Seeded"
        value={`€${fmtNum(totalSpend)}`}
        delta={spendDelta}
        icon={<IconEuro />}
        iconColor="#F59E0B"
        iconBg="rgba(245,158,11,0.1)"
      />
      <StatCard
        label="Units Sent"
        value={totalUnits}
        icon={<IconBox />}
        iconColor="#3B82F6"
        iconBg="rgba(59,130,246,0.1)"
      />
      <StatCard
        label="In Transit"
        value={activeSeedings}
        icon={<IconTruck />}
        iconColor="#7C6FF7"
        iconBg="rgba(124,111,247,0.1)"
      />
      <StatCard
        label="Influencers"
        value={totalInfluencers}
        icon={<IconUsers />}
        iconColor="#10B981"
        iconBg="rgba(16,185,129,0.1)"
      />
    </div>
  );

  const renderPipeline = () => (
    <div>
      <Label>Pipeline</Label>
      {totalSeedings === 0 ? (
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--pt-text-muted)' }}>No seedings yet.</p>
      ) : (
        <>
          <div style={{ display: 'flex', height: '3px', borderRadius: '99px', overflow: 'hidden',
            backgroundColor: 'var(--pt-surface-high)', marginBottom: '20px' }}>
            {pipeline.filter(s => s.count > 0).map(s => (
              <div key={s.label} title={`${s.label}: ${s.count}`}
                style={{ width: `${(s.count / totalSeedings) * 100}%`, backgroundColor: s.color }} />
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {pipeline.map(s => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%',
                    backgroundColor: s.color, flexShrink: 0 }} />
                  <span style={{ fontSize: '12px', color: 'var(--pt-text-sub)' }}>{s.label}</span>
                </div>
                <span style={{ fontSize: '14px', fontWeight: '700', color: 'var(--pt-text)' }}>{s.count}</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--pt-text-muted)', marginTop: '16px' }}>
            {completionRate}% delivered
          </div>
        </>
      )}
    </div>
  );

  const renderRecent = () => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
        <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase',
          letterSpacing: '1px', color: 'var(--pt-text-muted)' }}>Recent Seedings</div>
        <Link to="/portal/seedings" style={{ fontSize: '11px', color: 'var(--pt-accent)',
          fontWeight: '600', textDecoration: 'none' }}>View all →</Link>
      </div>
      {recentSeedings.length === 0 ? (
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--pt-text-muted)' }}>No seedings yet.</p>
      ) : (
        <div>
          {recentSeedings.slice(0, 6).map((s, i) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 0', borderTop: i === 0 ? 'none' : '1px solid var(--pt-border-light)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                {s.influencer?.country && <FlagImg country={s.influencer.country} size={13} />}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--pt-text)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.influencer?.name || `@${s.influencer?.handle}`}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--pt-text-muted)', marginTop: '1px' }}>
                    {s.campaign?.title || '—'} · {fmtDate(s.createdAt, 'short')}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0, marginLeft: '16px' }}>
                <StatusDot status={s.status} />
                <span style={{ fontSize: '13px', fontWeight: '700', color: 'var(--pt-text)',
                  minWidth: '52px', textAlign: 'right' }}>
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
            <div key={d.country} style={{ display: 'flex', alignItems: 'center', gap: '12px',
              padding: '10px 0', borderTop: i === 0 ? 'none' : '1px solid var(--pt-border-light)' }}>
              <FlagImg country={d.country} size={17} />
              <span style={{ flex: 1, fontSize: '13px', fontWeight: '500', color: 'var(--pt-text)' }}>
                {d.country}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--pt-text-muted)' }}>{d.seedings} seedings</span>
              <span style={{ fontSize: '13px', fontWeight: '700', color: 'var(--pt-text)',
                minWidth: '56px', textAlign: 'right' }}>€{fmtNum(d.spend)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderInfluencers = () => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
        <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase',
          letterSpacing: '1px', color: 'var(--pt-text-muted)' }}>Top Influencers</div>
        <Link to="/portal/influencers" style={{ fontSize: '11px', color: 'var(--pt-accent)',
          fontWeight: '600', textDecoration: 'none' }}>View all →</Link>
      </div>
      {topInfluencers.length === 0 ? (
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--pt-text-muted)' }}>No influencers yet.</p>
      ) : (
        <div>
          {topInfluencers.map((inf, i) => (
            <Link key={inf.id} to={`/portal/influencers/${inf.id}`} style={{ textDecoration: 'none',
              display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0',
              borderTop: i === 0 ? 'none' : '1px solid var(--pt-border-light)' }}>
              <span style={{ fontSize: '10px', fontWeight: '700', color: 'var(--pt-text-muted)',
                width: '14px', textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--pt-text)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {inf.name || `@${inf.handle}`}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--pt-text-muted)',
                  display: 'flex', alignItems: 'center', gap: '6px', marginTop: '1px' }}>
                  <FlagImg country={inf.country} size={11} />
                  {inf.country || '—'} · {fmtFollowers(inf.followers)}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--pt-text)' }}>
                  {inf._count.seedings}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--pt-text-muted)' }}>seedings</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0, minWidth: '52px' }}>
                <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--pt-accent)' }}>
                  €{fmtNum(inf.totalSpend)}
                </div>
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
      return <Band key={id} {...bandProps(id)}>{renderStats()}</Band>;
    }
    if (id === 'midrow') {
      const showP = vis('pipeline'), showR = vis('recent');
      if (!showP && !showR) return null;
      return (
        <Band key={id} {...bandProps(id)}>
          <div style={{ display: 'grid',
            gridTemplateColumns: showP && showR ? '220px 1fr' : '1fr',
            gap: '0 60px', alignItems: 'start' }}>
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
          <div style={{ display: 'grid',
            gridTemplateColumns: showC && showI ? '1fr 1fr' : '1fr',
            gap: '60px', alignItems: 'start' }}>
            {showC && renderCountries()}
            {showI && renderInfluencers()}
          </div>
        </Band>
      );
    }
    return null;
  };

  const visibleBands = bandOrder.filter(id => {
    if (id === 'stats')  return vis('stats');
    if (id === 'midrow') return vis('pipeline') || vis('recent');
    if (id === 'botrow') return (vis('countries') && !activeCountry) || vis('influencers');
    return false;
  });

  return (
    <div style={{ paddingBottom: '60px' }}>

      {/* ── Header ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '36px' }}>
        <h1 style={{ margin: 0, fontSize: '18px', fontWeight: '700', color: 'var(--pt-text)', letterSpacing: '-0.3px' }}>
          Overview
        </h1>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Time filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px',
            backgroundColor: 'var(--pt-surface-high)', borderRadius: '99px',
            padding: '3px', border: '1px solid var(--pt-border)' }}>
            {TIME_OPTIONS.map(opt => (
              <button key={opt.value ?? 'mtd'} onClick={() => toggleDays(opt.value)} style={pill(activeDays === opt.value)}>
                {opt.label}
              </button>
            ))}
            {activeDays && (
              <button onClick={() => navigate(buildUrl(null, activeCountry))}
                style={{ ...pill(false), color: 'var(--pt-text-muted)', padding: '5px 9px' }}>✕</button>
            )}
          </div>

          {/* Country filter */}
          {countryPills.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '2px',
              backgroundColor: 'var(--pt-surface-high)', borderRadius: '99px',
              padding: '3px', border: '1px solid var(--pt-border)' }}>
              {countryPills.map(country => (
                <button key={country} onClick={() => toggleCountry(country)}
                  style={{ ...pill(activeCountry === country), gap: '5px' }}>
                  <FlagImg country={country} size={14} />
                  <span>{country.split(' ')[0]}</span>
                </button>
              ))}
              {activeCountry && (
                <button onClick={() => navigate(buildUrl(activeDays, null))}
                  style={{ ...pill(false), color: 'var(--pt-text-muted)', padding: '5px 9px' }}>✕</button>
              )}
            </div>
          )}

          {/* Edit toggle */}
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

      {/* ── Edit panel ──────────────────────────────────────────── */}
      {editMode && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap',
          backgroundColor: 'var(--pt-surface)', border: '1px solid var(--pt-border)',
          borderRadius: '10px', padding: '12px 16px', marginBottom: '28px',
        }}>
          <span style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase',
            letterSpacing: '0.8px', color: 'var(--pt-text-muted)', flexShrink: 0 }}>
            Sections
          </span>
          {SECTION_DEFS.map(s => (
            <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '6px',
              cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={vis(s.id)} onChange={() => toggleSection(s.id)}
                style={{ accentColor: 'var(--pt-accent)', width: '13px', height: '13px' }} />
              <span style={{ fontSize: '12px', color: vis(s.id) ? 'var(--pt-text)' : 'var(--pt-text-muted)',
                fontWeight: '500' }}>
                {s.label}
              </span>
            </label>
          ))}
          <span style={{ fontSize: '11px', color: 'var(--pt-text-muted)', marginLeft: 'auto' }}>
            Drag rows to reorder
          </span>
        </div>
      )}

      {/* ── Hero: big number + line chart ───────────────────────── */}
      <div style={{ marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '14px', marginBottom: '4px' }}>
          <span style={{ fontSize: '56px', fontWeight: '800', letterSpacing: '-2.5px', lineHeight: 1, color: 'var(--pt-text)' }}>
            {chartTotal}
          </span>
          <span style={{ fontSize: '16px', color: 'var(--pt-text-muted)', fontWeight: '400' }}>seedings</span>
          <Delta delta={countDelta} />
        </div>
        <div style={{ fontSize: '13px', color: 'var(--pt-text-muted)', marginBottom: '24px' }}>
          {rangeLabel}
          {activeCountry && <span> · {activeCountry}</span>}
          {peakDay.seedings > 0 && (
            <span> · peak <strong style={{ color: 'var(--pt-text-sub)', fontWeight: '600' }}>{peakDay.label}</strong></span>
          )}
        </div>
        <LineChart days={chartDays} />
      </div>

      {/* ── Draggable bands ─────────────────────────────────────── */}
      {visibleBands.length > 0 && (
        <div style={{ marginTop: editMode ? '28px' : '0' }}>
          {bandOrder.map((id) => {
            const content = renderBand(id);
            if (!content) return null;
            return (
              <div key={id}>
                <Rule my={36} />
                {content}
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
