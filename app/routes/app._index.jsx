import { useLoaderData, useRouteError } from 'react-router';
import { useState } from 'react';
import { boundary } from '@shopify/shopify-app-react-router/server';
import prisma from '../db.server';
import { C, card, section, btn, fmtNum } from '../theme';

const STATUSES = ['Pending', 'Ordered', 'Shipped', 'Delivered', 'Posted'];

export async function loader() {
  const seedings = await prisma.seeding.findMany({
    include: {
      influencer: { select: { country: true } },
      products:   { select: { productId: true, productName: true, imageUrl: true, price: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  // Pass server timestamp so client hydration uses the same value (avoids React #418)
  return { seedings, now: Date.now() };
}

const PERIODS = [
  { label: '7d',  days: 7,   display: '7 days'    },
  { label: '30d', days: 30,  display: '30 days'   },
  { label: 'Q',   days: 90,  display: 'Quarterly' },
  { label: '1Y',  days: 365, display: 'Yearly'    },
];

// Country name → ISO-2 code
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

const CHART_COLORS = ['#D97757','#60A5FA','#34D399','#A78BFA','#F472B6','#FBBF24','#FB923C','#6EE7B7'];

// Pure SVG donut — no library, deterministic (no hydration risk)
function DonutChart({ data, total }) {
  if (!total) return null;
  const cx = 90, cy = 90, r = 66, ir = 44;
  const pt = n => Math.round(n * 10000) / 10000; // stable precision
  let angle = -Math.PI / 2; // start at 12 o'clock

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
      {/* Background ring */}
      <circle cx={cx} cy={cy} r={(r + ir) / 2} fill="none" stroke={C.surfaceHigh}
        strokeWidth={r - ir} />
      {data.map((d, i) => {
        const sweep  = (d.units / total) * 2 * Math.PI;
        const startA = angle;
        angle += sweep;
        return (
          <path key={d.country} d={slicePath(startA, angle)}
            fill={CHART_COLORS[i % CHART_COLORS.length]} />
        );
      })}
      {/* Centre */}
      <text x={cx} y={cy - 8} textAnchor="middle" fontSize="22" fontWeight="900"
        fill={C.text} fontFamily="system-ui,sans-serif">{data.length}</text>
      <text x={cx} y={cy + 10} textAnchor="middle" fontSize="11" fill={C.textSub}
        fontFamily="system-ui,sans-serif">countries</text>
    </svg>
  );
}

function getTopProducts(seedings, days, now) {
  const cutoff = new Date(now);
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

function getCountryData(seedings) {
  const map = {};
  for (const s of seedings) {
    const c = s.influencer.country || 'Unknown';
    if (!map[c]) map[c] = { seedings: 0, units: 0 };
    map[c].seedings++;
    map[c].units += s.products.length;
  }
  return Object.entries(map)
    .map(([country, d]) => ({ country, ...d }))
    .sort((a, b) => b.units - a.units);
}

export default function Dashboard() {
  const { seedings, now } = useLoaderData();
  const [period, setPeriod] = useState('30d');

  const selectedPeriod = PERIODS.find(p => p.label === period);
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - selectedPeriod.days);
  const filtered = seedings.filter(s => new Date(s.createdAt) >= cutoff);

  const topProducts = getTopProducts(seedings, selectedPeriod.days, now);
  const totalCost   = filtered.reduce((sum, s) => sum + s.totalCost, 0);
  const totalUnits  = filtered.reduce((sum, s) => sum + s.products.length, 0);
  const countryData = getCountryData(filtered);
  const totalUnitsAll = countryData.reduce((s, d) => s + d.units, 0);

  const stats = [
    { label: 'Total Seedings', value: filtered.length },
    { label: 'Total Invested', value: `€${fmtNum(totalCost)}` },
    { label: 'Units Sent',     value: totalUnits },
    { label: 'Countries',      value: countryData.length || 0 },
  ];

  const statusCounts = STATUSES.reduce((acc, s) => {
    acc[s] = filtered.filter(sd => sd.status === s).length;
    return acc;
  }, {});

  return (
    <div>
      {/* Period filter */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ margin: 0, fontSize: '15px', fontWeight: '700', color: C.text }}>
          Past {selectedPeriod.display}
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

      {/* Stat tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '28px' }}>
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
      <div style={{ marginBottom: '36px' }}>
        <h2 style={{ margin: '0 0 16px', ...section.title }}>Top products</h2>
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
                    <div style={{ width: '100%', aspectRatio: '4/3', backgroundColor: '#FFFFFF', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <img src={prod.image} alt={prod.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    </div>
                  ) : (
                    <div style={{ width: '100%', aspectRatio: '4/3', backgroundColor: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '36px' }}>📦</div>
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

      {/* Countries */}
      <div>
        <h2 style={{ margin: '0 0 16px', ...section.title }}>Reach by country</h2>
        {countryData.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', border: `2px dashed ${C.border}`, color: C.textMuted, fontSize: '13px', borderRadius: '8px' }}>
            No seedings in this period yet.
          </div>
        ) : (
          <div style={{ ...card.base, display: 'flex', gap: '32px', alignItems: 'flex-start' }}>
            {/* Donut chart */}
            <div style={{ flexShrink: 0 }}>
              <DonutChart data={countryData.slice(0, 8)} total={totalUnitsAll} />
              {/* Legend */}
              <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                {countryData.slice(0, 8).map((d, i) => (
                  <div key={d.country} style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                    <div style={{ width: '10px', height: '10px', borderRadius: '2px', backgroundColor: CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0 }} />
                    <span style={{ fontSize: '11px', color: C.textSub }}>{getFlag(d.country)} {d.country}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Divider */}
            <div style={{ width: '1px', backgroundColor: C.borderLight, alignSelf: 'stretch' }} />

            {/* Country list */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {countryData.map((d, i) => {
                const pct = totalUnitsAll > 0 ? (d.units / totalUnitsAll) * 100 : 0;
                return (
                  <div key={d.country}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '18px', lineHeight: 1 }}>{getFlag(d.country)}</span>
                        <span style={{ fontSize: '13px', fontWeight: '700', color: C.text }}>{d.country}</span>
                        <span style={{ fontSize: '11px', color: C.textMuted }}>
                          {d.seedings} seeding{d.seedings !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '13px', fontWeight: '800', color: i < CHART_COLORS.length ? CHART_COLORS[i] : C.textSub }}>
                          {d.units} unit{d.units !== 1 ? 's' : ''}
                        </span>
                        <span style={{ fontSize: '11px', color: C.textMuted, width: '34px', textAlign: 'right' }}>
                          {Math.round(pct)}%
                        </span>
                      </div>
                    </div>
                    <div style={{ height: '4px', backgroundColor: C.surfaceHigh, borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, backgroundColor: i < CHART_COLORS.length ? CHART_COLORS[i] : C.textMuted, borderRadius: '2px', transition: 'width 0.4s ease' }} />
                    </div>
                  </div>
                );
              })}
            </div>
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
