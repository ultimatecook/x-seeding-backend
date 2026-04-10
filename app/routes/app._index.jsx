import { useLoaderData, useRouteError } from 'react-router';
import { useState } from 'react';
import { boundary } from '@shopify/shopify-app-react-router/server';
import prisma from '../db.server';
import { fmtNum } from '../theme';

const STATUSES = ['Pending', 'Ordered', 'Shipped', 'Delivered', 'Posted'];

export async function loader() {
  const seedings = await prisma.seeding.findMany({
    include: {
      influencer: { select: { country: true } },
      products:   { select: { productId: true, productName: true, imageUrl: true, price: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return { seedings, now: Date.now() };
}

// ── Design tokens ─────────────────────────────────────────────────────────────
const D = {
  bg:          '#F7F8FA',
  surface:     '#FFFFFF',
  surfaceHigh: '#F3F4F6',
  border:      '#E8E9EC',
  borderLight: '#F0F1F3',
  accent:      '#D97757',
  accentLight: '#FDF0EB',
  text:        '#111827',
  textSub:     '#6B7280',
  textMuted:   '#9CA3AF',
  shadow:      '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
};

const STATUS_META = {
  Pending:   { bg: '#FFFBEB', text: '#B45309', dot: '#F59E0B' },
  Ordered:   { bg: '#EFF6FF', text: '#1D4ED8', dot: '#3B82F6' },
  Shipped:   { bg: '#F0FDF4', text: '#15803D', dot: '#22C55E' },
  Delivered: { bg: '#F0FDFA', text: '#0F766E', dot: '#14B8A6' },
  Posted:    { bg: '#FDF4FF', text: '#7E22CE', dot: '#A855F7' },
};

const CHART_COLORS = ['#D97757','#60A5FA','#34D399','#A78BFA','#F472B6','#FBBF24','#FB923C','#6EE7B7'];

const PERIODS = [
  { label: '7d',  days: 7,   display: '7 days'    },
  { label: '30d', days: 30,  display: '30 days'   },
  { label: 'Q',   days: 90,  display: 'Quarterly' },
  { label: '1Y',  days: 365, display: 'Yearly'    },
];

const COUNTRY_CODES = {
  'Afghanistan':'AF','Albania':'AL','Algeria':'DZ','Andorra':'AD','Angola':'AO',
  'Argentina':'AR','Armenia':'AM','Australia':'AU','Austria':'AT','Azerbaijan':'AZ',
  'Bahrain':'BH','Bangladesh':'BD','Belarus':'BY','Belgium':'BE','Bolivia':'BO',
  'Bosnia and Herzegovina':'BA','Brazil':'BR','Bulgaria':'BG',
  'Cambodia':'KH','Cameroon':'CM','Canada':'CA','Chile':'CL','China':'CN',
  'Colombia':'CO','Costa Rica':'CR','Croatia':'HR','Cuba':'CU','Cyprus':'CY','Czech Republic':'CZ',
  'Denmark':'DK','Dominican Republic':'DO',
  'Ecuador':'EC','Egypt':'EG','El Salvador':'SV','Estonia':'EE','Ethiopia':'ET',
  'Finland':'FI','France':'FR',
  'Georgia':'GE','Germany':'DE','Ghana':'GH','Greece':'GR','Guatemala':'GT',
  'Honduras':'HN','Hungary':'HU',
  'Iceland':'IS','India':'IN','Indonesia':'ID','Iran':'IR','Iraq':'IQ',
  'Ireland':'IE','Israel':'IL','Italy':'IT',
  'Jamaica':'JM','Japan':'JP','Jordan':'JO',
  'Kazakhstan':'KZ','Kenya':'KE','Kuwait':'KW',
  'Latvia':'LV','Lebanon':'LB','Lithuania':'LT','Luxembourg':'LU',
  'Malaysia':'MY','Mexico':'MX','Moldova':'MD','Morocco':'MA','Myanmar':'MM',
  'Nepal':'NP','Netherlands':'NL','New Zealand':'NZ','Nigeria':'NG',
  'North Macedonia':'MK','Norway':'NO',
  'Pakistan':'PK','Panama':'PA','Paraguay':'PY','Peru':'PE','Philippines':'PH',
  'Poland':'PL','Portugal':'PT',
  'Qatar':'QA',
  'Romania':'RO','Russia':'RU',
  'Saudi Arabia':'SA','Serbia':'RS','Singapore':'SG','Slovakia':'SK',
  'Slovenia':'SI','South Africa':'ZA','South Korea':'KR','Spain':'ES',
  'Sri Lanka':'LK','Sweden':'SE','Switzerland':'CH',
  'Taiwan':'TW','Thailand':'TH','Tunisia':'TN','Turkey':'TR',
  'Ukraine':'UA','United Arab Emirates':'AE','United Kingdom':'GB',
  'United States':'US','Uruguay':'UY','Uzbekistan':'UZ',
  'Venezuela':'VE','Vietnam':'VN',
  'Yemen':'YE','Zimbabwe':'ZW',
};

function getFlag(name) {
  const code = COUNTRY_CODES[name];
  if (!code) return '🌍';
  return [...code].map(c => String.fromCodePoint(0x1F1E0 + c.charCodeAt(0) - 65)).join('');
}

// Pure SVG donut — no library, deterministic
function DonutChart({ data, total }) {
  if (!total) return null;
  const cx = 90, cy = 90, r = 66, ir = 44;
  const pt = n => Math.round(n * 10000) / 10000;
  let angle = -Math.PI / 2;

  function slicePath(startA, endA) {
    const cos1 = pt(Math.cos(startA)), sin1 = pt(Math.sin(startA));
    const cos2 = pt(Math.cos(endA)),   sin2 = pt(Math.sin(endA));
    const large = endA - startA > Math.PI ? 1 : 0;
    return [
      `M ${pt(cx + cos1 * ir)} ${pt(cy + sin1 * ir)}`,
      `L ${pt(cx + cos1 * r)}  ${pt(cy + sin1 * r)}`,
      `A ${r} ${r} 0 ${large} 1 ${pt(cx + cos2 * r)} ${pt(cy + sin2 * r)}`,
      `L ${pt(cx + cos2 * ir)} ${pt(cy + sin2 * ir)}`,
      `A ${ir} ${ir} 0 ${large} 0 ${pt(cx + cos1 * ir)} ${pt(cy + sin1 * ir)}`,
      'Z',
    ].join(' ');
  }

  return (
    <svg width="180" height="180" viewBox="0 0 180 180">
      <circle cx={cx} cy={cy} r={(r + ir) / 2} fill="none" stroke={D.surfaceHigh} strokeWidth={r - ir} />
      {data.map((d, i) => {
        const sweep  = (d.units / total) * 2 * Math.PI;
        const startA = angle;
        angle += sweep;
        return (
          <path key={d.country} d={slicePath(startA, angle)}
            fill={CHART_COLORS[i % CHART_COLORS.length]} />
        );
      })}
      <text x={cx} y={cy - 8} textAnchor="middle" fontSize="22" fontWeight="900"
        fill={D.text} fontFamily="system-ui,sans-serif">{data.length}</text>
      <text x={cx} y={cy + 10} textAnchor="middle" fontSize="11" fill={D.textSub}
        fontFamily="system-ui,sans-serif">countries</text>
    </svg>
  );
}

function getTopProducts(seedings) {
  const map = {};
  for (const s of seedings) {
    for (const p of s.products) {
      if (!map[p.productId]) map[p.productId] = { name: p.productName, image: p.imageUrl, count: 0, worth: 0 };
      map[p.productId].count += 1;
      map[p.productId].worth += p.price;
    }
  }
  return Object.values(map).sort((a, b) => b.count - a.count).slice(0, 4);
}

function getCountryData(seedings) {
  const map = {};
  for (const s of seedings) {
    const c = s.influencer.country || 'Unknown';
    if (!map[c]) map[c] = { seedings: 0, units: 0, spend: 0 };
    map[c].seedings++;
    map[c].units += s.products.length;
    map[c].spend  += s.totalCost;
  }
  return Object.entries(map)
    .map(([country, d]) => ({ country, ...d }))
    .sort((a, b) => b.spend - a.spend);
}

// ── Components ────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub }) {
  return (
    <div style={{
      backgroundColor: D.surface,
      border: `1px solid ${D.border}`,
      borderRadius: '12px',
      padding: '20px 22px',
      boxShadow: D.shadow,
    }}>
      <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.8px', color: D.textMuted, marginBottom: '8px' }}>
        {label}
      </div>
      <div style={{ fontSize: '30px', fontWeight: '800', color: D.text, letterSpacing: '-1px', lineHeight: 1.1 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: '12px', color: D.textSub, fontWeight: '500', marginTop: '5px' }}>{sub}</div>
      )}
    </div>
  );
}

function StatusPill({ status, count }) {
  const m = STATUS_META[status] || { bg: '#F3F4F6', text: '#374151', dot: '#9CA3AF' };
  return (
    <div style={{
      backgroundColor: D.surface,
      border: `1px solid ${D.border}`,
      borderRadius: '10px',
      padding: '12px 16px',
      boxShadow: D.shadow,
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: m.dot, flexShrink: 0 }} />
        <span style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.6px', color: D.textMuted }}>
          {status}
        </span>
      </div>
      <span style={{ fontSize: '26px', fontWeight: '800', color: D.text, letterSpacing: '-0.5px', lineHeight: 1 }}>
        {count}
      </span>
    </div>
  );
}

export default function Dashboard() {
  const { seedings, now } = useLoaderData();
  const [period,  setPeriod]  = useState('30d');
  const [country, setCountry] = useState('all');

  const selectedPeriod = PERIODS.find(p => p.label === period);
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - selectedPeriod.days);

  const byPeriod     = seedings.filter(s => new Date(s.createdAt) >= cutoff);
  const allCountries = [...new Set(byPeriod.map(s => s.influencer.country || 'Unknown'))].sort();

  const filtered = byPeriod.filter(s =>
    country === 'all' || (s.influencer.country || 'Unknown') === country
  );

  const topProducts   = getTopProducts(filtered);
  const totalCost     = filtered.reduce((sum, s) => sum + s.totalCost, 0);
  const totalUnits    = filtered.reduce((sum, s) => sum + s.products.length, 0);
  const countryData   = getCountryData(filtered);
  const totalUnitsAll = countryData.reduce((s, d) => s + d.units, 0);

  const statusCounts = STATUSES.reduce((acc, s) => {
    acc[s] = filtered.filter(sd => sd.status === s).length;
    return acc;
  }, {});

  return (
    <div style={{ display: 'grid', gap: '20px' }}>

      {/* ── Header row: title + period filters ─────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: D.text, letterSpacing: '-0.3px' }}>
            Dashboard
          </h2>
          <p style={{ margin: '2px 0 0', fontSize: '13px', color: D.textSub }}>
            Past {selectedPeriod.display}{country !== 'all' ? ` · ${getFlag(country)} ${country}` : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '4px', backgroundColor: D.surfaceHigh, borderRadius: '8px', padding: '3px' }}>
          {PERIODS.map(p => (
            <button key={p.label} type="button" onClick={() => setPeriod(p.label)}
              style={{
                padding: '5px 14px', fontSize: '12px', fontWeight: '700',
                border: 'none', cursor: 'pointer', borderRadius: '6px',
                backgroundColor: period === p.label ? D.surface : 'transparent',
                color: period === p.label ? D.text : D.textMuted,
                boxShadow: period === p.label ? D.shadow : 'none',
                transition: 'all 0.12s',
              }}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Country filter pills ────────────────────────────── */}
      {allCountries.length > 1 && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => setCountry('all')} style={{
            padding: '5px 14px', fontSize: '12px', fontWeight: '600', borderRadius: '20px',
            border: `1.5px solid ${country === 'all' ? D.accent : D.border}`,
            backgroundColor: country === 'all' ? D.accent : D.surface,
            color: country === 'all' ? '#fff' : D.textSub, cursor: 'pointer',
          }}>All countries</button>
          {allCountries.map(c => (
            <button key={c} type="button" onClick={() => setCountry(country === c ? 'all' : c)} style={{
              padding: '5px 14px', fontSize: '12px', fontWeight: '600', borderRadius: '20px',
              border: `1.5px solid ${country === c ? D.accent : D.border}`,
              backgroundColor: country === c ? D.accentLight : D.surface,
              color: country === c ? D.accent : D.textSub, cursor: 'pointer',
            }}>{getFlag(c)} {c}</button>
          ))}
        </div>
      )}

      {/* ── KPI cards ───────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
        <KpiCard label="Total Seedings" value={filtered.length} sub="In period" />
        <KpiCard label="Total Invested" value={`€${fmtNum(totalCost)}`} sub="Retail value" />
        <KpiCard label="Units Sent" value={totalUnits} sub="Across all products" />
        <KpiCard label="Countries" value={country === 'all' ? countryData.length : 1} sub="Markets reached" />
      </div>

      {/* ── Status pipeline ─────────────────────────────────── */}
      <div style={{
        backgroundColor: D.surface,
        border: `1px solid ${D.border}`,
        borderRadius: '12px',
        padding: '20px 24px',
        boxShadow: D.shadow,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.8px', color: D.textMuted }}>
            Seeding Pipeline
          </h3>
          <span style={{ fontSize: '11px', color: D.textMuted, fontWeight: '600' }}>{filtered.length} total</span>
        </div>

        {filtered.length === 0 ? (
          <p style={{ margin: 0, color: D.textMuted, fontSize: '13px' }}>No seedings in this period.</p>
        ) : (
          <>
            {/* Stacked progress bar */}
            <div style={{ display: 'flex', height: '8px', borderRadius: '99px', overflow: 'hidden', marginBottom: '16px', backgroundColor: D.surfaceHigh }}>
              {STATUSES.map((s, i) => {
                const pct = filtered.length > 0 ? (statusCounts[s] / filtered.length) * 100 : 0;
                return pct > 0 ? (
                  <div key={s} style={{ width: `${pct}%`, backgroundColor: CHART_COLORS[i], transition: 'width 0.3s' }} />
                ) : null;
              })}
            </div>

            {/* Status cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px' }}>
              {STATUSES.map(s => (
                <StatusPill key={s} status={s} count={statusCounts[s]} />
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Country breakdown ───────────────────────────────── */}
      <div style={{
        backgroundColor: D.surface,
        border: `1px solid ${D.border}`,
        borderRadius: '12px',
        boxShadow: D.shadow,
        overflow: 'hidden',
      }}>
        <div style={{ padding: '18px 24px', borderBottom: `1px solid ${D.border}` }}>
          <h3 style={{ margin: 0, fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.8px', color: D.textMuted }}>
            Reach by Country
          </h3>
        </div>

        {countryData.length === 0 ? (
          <div style={{ padding: '48px 24px', textAlign: 'center', color: D.textMuted, fontSize: '13px' }}>
            No seedings in this period yet.
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '0', alignItems: 'flex-start' }}>
            {/* Donut + legend */}
            <div style={{ padding: '24px', flexShrink: 0, borderRight: `1px solid ${D.border}` }}>
              <DonutChart data={countryData.slice(0, 8)} total={totalUnitsAll} />
              <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {countryData.slice(0, 8).map((d, i) => (
                  <div key={d.country} style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '2px', backgroundColor: CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0 }} />
                    <span style={{ fontSize: '11px', color: D.textSub }}>{getFlag(d.country)} {d.country}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Country rows */}
            <div style={{ flex: 1, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {(() => {
                const totalSpend = countryData.reduce((s, x) => s + x.spend, 0);
                return countryData.map((d, i) => {
                  const pct   = totalSpend > 0 ? (d.spend / totalSpend) * 100 : 0;
                  const color = CHART_COLORS[i % CHART_COLORS.length];
                  return (
                    <div key={d.country}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '18px', lineHeight: 1 }}>{getFlag(d.country)}</span>
                          <span style={{ fontSize: '13px', fontWeight: '700', color: D.text }}>{d.country}</span>
                          <span style={{ fontSize: '11px', color: D.textMuted }}>
                            {d.seedings} seeding{d.seedings !== 1 ? 's' : ''} · {d.units} unit{d.units !== 1 ? 's' : ''}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <span style={{ fontSize: '14px', fontWeight: '800', color }}>€{fmtNum(d.spend)}</span>
                          <span style={{ fontSize: '11px', color: D.textMuted, width: '32px', textAlign: 'right' }}>{Math.round(pct)}%</span>
                        </div>
                      </div>
                      <div style={{ height: '5px', backgroundColor: D.surfaceHigh, borderRadius: '99px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, backgroundColor: color, borderRadius: '99px', transition: 'width 0.4s ease' }} />
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}
      </div>

      {/* ── Top products ────────────────────────────────────── */}
      {topProducts.length > 0 && (
        <div style={{
          backgroundColor: D.surface,
          border: `1px solid ${D.border}`,
          borderRadius: '12px',
          boxShadow: D.shadow,
          overflow: 'hidden',
        }}>
          <div style={{ padding: '18px 24px', borderBottom: `1px solid ${D.border}` }}>
            <h3 style={{ margin: 0, fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.8px', color: D.textMuted }}>
              Top Products
            </h3>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
            {topProducts.map((prod, i) => (
              <div key={prod.name} style={{
                borderRight: i < topProducts.length - 1 ? `1px solid ${D.border}` : 'none',
                overflow: 'hidden',
              }}>
                <div style={{ position: 'relative' }}>
                  {prod.image ? (
                    <div style={{ width: '100%', aspectRatio: '4/3', backgroundColor: D.surfaceHigh, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <img src={prod.image} alt={prod.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    </div>
                  ) : (
                    <div style={{ width: '100%', aspectRatio: '4/3', backgroundColor: D.surfaceHigh, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '36px' }}>📦</div>
                  )}
                  <div style={{
                    position: 'absolute', top: '10px', left: '10px',
                    backgroundColor: D.accent, color: '#fff',
                    fontSize: '10px', fontWeight: '800', padding: '3px 8px', borderRadius: '6px',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
                  }}>#{i + 1}</div>
                </div>
                <div style={{ padding: '16px' }}>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: D.text, marginBottom: '10px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {prod.name}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '5px', marginBottom: '4px' }}>
                    <span style={{ fontSize: '24px', fontWeight: '800', color: D.accent, lineHeight: 1, letterSpacing: '-0.5px' }}>{prod.count}</span>
                    <span style={{ fontSize: '11px', color: D.textMuted, textTransform: 'uppercase', letterSpacing: '0.4px' }}>seeded</span>
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: D.text }}>
                    €{prod.worth.toFixed(2)} <span style={{ fontSize: '11px', color: D.textMuted, fontWeight: '400' }}>retail value</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
