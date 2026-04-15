import { useLoaderData, Link } from 'react-router';
import prisma from '../db.server';
import { requirePortalUser } from '../utils/portal-auth.server';
import { fmtDate, fmtNum } from '../theme';
import { D } from '../utils/portal-theme';

// ── Loader ────────────────────────────────────────────────────────────────────
export async function loader({ request }) {
  const { shop } = await requirePortalUser(request);

  const now       = new Date();
  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const start12Weeks     = new Date(now); start12Weeks.setDate(now.getDate() - 83); // 12 weeks back

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
                 _count:    { select: { seedings: true } },
                 seedings:  { select: { totalCost: true } } },
    }),
    prisma.seeding.findMany({
      where:  { shop },
      select: { influencerId: true, totalCost: true, influencer: { select: { country: true } } },
      take:   2000,
    }),
    // All seedings in last 12 weeks for the bar chart
    prisma.seeding.findMany({
      where:  { shop, createdAt: { gte: start12Weeks } },
      select: { createdAt: true, totalCost: true },
    }),
    // This month total spend
    prisma.seeding.aggregate({
      where:  { shop, createdAt: { gte: startOfThisMonth } },
      _sum:   { totalCost: true },
      _count: { _all: true },
    }),
    // Last month total spend
    prisma.seeding.aggregate({
      where:  { shop, createdAt: { gte: startOfLastMonth, lt: startOfThisMonth } },
      _sum:   { totalCost: true },
      _count: { _all: true },
    }),
  ]);

  // Status map
  const countMap         = Object.fromEntries(statusCounts.map(r => [r.status, r._count._all]));
  const totalSeedings    = statusCounts.reduce((s, r) => s + r._count._all, 0);
  const pendingSeedings  = countMap['Pending']   ?? 0;
  const orderedSeedings  = countMap['Ordered']   ?? 0;
  const shippedSeedings  = countMap['Shipped']   ?? 0;
  const deliveredSeedings= countMap['Delivered'] ?? 0;
  const postedSeedings   = countMap['Posted']    ?? 0;

  // Total spend all time
  const totalSpend     = allSeedingsForCountry.reduce((s, x) => s + (x.totalCost ?? 0), 0);
  const thisMonthTotal = thisMonthSpend._sum.totalCost ?? 0;
  const lastMonthTotal = lastMonthSpend._sum.totalCost ?? 0;
  const spendDelta     = lastMonthTotal > 0
    ? Math.round(((thisMonthTotal - lastMonthTotal) / lastMonthTotal) * 100)
    : null;

  // Weekly bar chart — bucket into 12 weeks
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
    .slice(0, 10);

  // Top influencers with total spend
  const topInfluencersWithSpend = topInfluencers.map(inf => ({
    ...inf,
    totalSpend: inf.seedings.reduce((s, x) => s + (x.totalCost ?? 0), 0),
  }));

  return {
    totalSeedings, pendingSeedings, orderedSeedings,
    shippedSeedings, deliveredSeedings, postedSeedings,
    totalInfluencers, recentSeedings, countryData,
    topInfluencers: topInfluencersWithSpend,
    totalSpend, thisMonthTotal, lastMonthTotal, spendDelta,
    thisMonthCount: thisMonthSpend._count._all,
    weeks: weeks.map(w => ({ label: fmtWeekLabel(w.weekStart), seedings: w.seedings, spend: w.spend })),
  };
}

function fmtWeekLabel(d) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const COUNTRY_CODES = {
  'Afghanistan':'AF','Albania':'AL','Algeria':'DZ','Angola':'AO','Argentina':'AR',
  'Armenia':'AM','Australia':'AU','Austria':'AT','Azerbaijan':'AZ','Bahrain':'BH',
  'Bangladesh':'BD','Belarus':'BY','Belgium':'BE','Bolivia':'BO','Bosnia and Herzegovina':'BA',
  'Brazil':'BR','Bulgaria':'BG','Cambodia':'KH','Cameroon':'CM','Canada':'CA',
  'Chile':'CL','China':'CN','Colombia':'CO','Costa Rica':'CR','Croatia':'HR',
  'Cuba':'CU','Cyprus':'CY','Czech Republic':'CZ','Denmark':'DK','Dominican Republic':'DO',
  'Ecuador':'EC','Egypt':'EG','El Salvador':'SV','Estonia':'EE','Ethiopia':'ET',
  'Finland':'FI','France':'FR','Georgia':'GE','Germany':'DE','Ghana':'GH',
  'Greece':'GR','Guatemala':'GT','Honduras':'HN','Hungary':'HU','Iceland':'IS',
  'India':'IN','Indonesia':'ID','Iran':'IR','Iraq':'IQ','Ireland':'IE',
  'Israel':'IL','Italy':'IT','Jamaica':'JM','Japan':'JP','Jordan':'JO',
  'Kazakhstan':'KZ','Kenya':'KE','Kuwait':'KW','Latvia':'LV','Lebanon':'LB',
  'Lithuania':'LT','Luxembourg':'LU','Malaysia':'MY','Mexico':'MX','Moldova':'MD',
  'Morocco':'MA','Myanmar':'MM','Nepal':'NP','Netherlands':'NL','New Zealand':'NZ',
  'Nigeria':'NG','North Macedonia':'MK','Norway':'NO','Pakistan':'PK','Panama':'PA',
  'Paraguay':'PY','Peru':'PE','Philippines':'PH','Poland':'PL','Portugal':'PT',
  'Qatar':'QA','Romania':'RO','Russia':'RU','Saudi Arabia':'SA','Serbia':'RS',
  'Singapore':'SG','Slovakia':'SK','Slovenia':'SI','South Africa':'ZA',
  'South Korea':'KR','Spain':'ES','Sri Lanka':'LK','Sweden':'SE','Switzerland':'CH',
  'Taiwan':'TW','Thailand':'TH','Tunisia':'TN','Turkey':'TR','Ukraine':'UA',
  'United Arab Emirates':'AE','United Kingdom':'GB','United States':'US',
  'Uruguay':'UY','Uzbekistan':'UZ','Venezuela':'VE','Vietnam':'VN',
  'Yemen':'YE','Zimbabwe':'ZW',
};

function getFlag(name) {
  const code = COUNTRY_CODES[name];
  if (!code) return '🌍';
  return [...code].map(c => String.fromCodePoint(0x1F1E0 + c.charCodeAt(0) - 65)).join('');
}

function fmtFollowers(n) {
  if (!n) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

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
      borderRadius: '20px', padding: '3px 10px',
      fontSize: '11px', fontWeight: '700',
    }}>
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: m.dot, flexShrink: 0 }} />
      {status}
    </span>
  );
}

// ── Mini bar chart (pure CSS/SVG-free) ────────────────────────────────────────
function BarChart({ weeks }) {
  const maxVal = Math.max(...weeks.map(w => w.seedings), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '5px', height: '80px' }}>
      {weeks.map((w, i) => {
        const pct = (w.seedings / maxVal) * 100;
        const isLast = i === weeks.length - 1;
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', height: '100%', justifyContent: 'flex-end', position: 'relative', group: 'true' }}>
            <div
              title={`${w.label}: ${w.seedings} seedings`}
              style={{
                width: '100%',
                height: `${Math.max(pct, 4)}%`,
                borderRadius: '3px 3px 0 0',
                backgroundColor: isLast ? 'var(--pt-accent)' : 'var(--pt-surface-high)',
                border: isLast ? 'none' : `1px solid var(--pt-border)`,
                cursor: 'default',
                transition: 'background-color 0.15s',
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function PortalDashboard() {
  const {
    totalSeedings, pendingSeedings, orderedSeedings,
    shippedSeedings, deliveredSeedings, postedSeedings,
    totalInfluencers, recentSeedings, countryData,
    topInfluencers, totalSpend, thisMonthTotal, lastMonthTotal,
    spendDelta, thisMonthCount, weeks,
  } = useLoaderData();

  const totalCountrySpend = countryData.reduce((s, d) => s + d.spend, 0);
  const activeSeedings    = orderedSeedings + shippedSeedings;

  const statusPipeline = [
    { label: 'Pending',   count: pendingSeedings,   color: D.statusPending.dot },
    { label: 'Ordered',   count: orderedSeedings,   color: D.statusOrdered.dot },
    { label: 'Shipped',   count: shippedSeedings,   color: D.statusShipped.dot },
    { label: 'Delivered', count: deliveredSeedings, color: D.statusDelivered.dot },
    { label: 'Posted',    count: postedSeedings,    color: D.purple },
  ];

  return (
    <div style={{ display: 'grid', gap: '18px' }}>

      {/* ── Row 1: Hero spend + month + activity + influencers ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 160px 160px', gap: '14px' }}>

        {/* Total spend — hero */}
        <div style={{
          backgroundColor: D.surface, border: `1px solid ${D.border}`,
          borderRadius: '12px', padding: '22px 24px', boxShadow: D.shadow,
        }}>
          <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.8px', color: D.textMuted, marginBottom: '10px' }}>
            Total Value Seeded
          </div>
          <div style={{ fontSize: '38px', fontWeight: '800', color: D.text, letterSpacing: '-1.5px', lineHeight: 1 }}>
            €{fmtNum(totalSpend)}
          </div>
          <div style={{ fontSize: '12px', color: D.textSub, marginTop: '6px' }}>
            Retail value across {totalSeedings} seeding{totalSeedings !== 1 ? 's' : ''}
          </div>
        </div>

        {/* This month */}
        <div style={{
          backgroundColor: D.surface, border: `1px solid ${D.border}`,
          borderRadius: '12px', padding: '22px 24px', boxShadow: D.shadow,
        }}>
          <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.8px', color: D.textMuted, marginBottom: '10px' }}>
            This Month
          </div>
          <div style={{ fontSize: '38px', fontWeight: '800', color: D.text, letterSpacing: '-1.5px', lineHeight: 1 }}>
            €{fmtNum(thisMonthTotal)}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
            <span style={{ fontSize: '12px', color: D.textSub }}>{thisMonthCount} seedings</span>
            {spendDelta !== null && (
              <span style={{
                fontSize: '11px', fontWeight: '700', padding: '2px 7px', borderRadius: '20px',
                backgroundColor: spendDelta >= 0 ? D.statusDelivered.bg : D.statusPending.bg,
                color:           spendDelta >= 0 ? D.statusDelivered.color : D.statusPending.color,
              }}>
                {spendDelta >= 0 ? '↑' : '↓'} {Math.abs(spendDelta)}% vs last month
              </span>
            )}
          </div>
        </div>

        {/* Active */}
        <div style={{
          backgroundColor: D.surface, border: `1px solid ${D.border}`,
          borderRadius: '12px', padding: '22px 20px', boxShadow: D.shadow,
        }}>
          <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.8px', color: D.textMuted, marginBottom: '10px' }}>
            In Transit
          </div>
          <div style={{ fontSize: '38px', fontWeight: '800', color: D.accent, letterSpacing: '-1.5px', lineHeight: 1 }}>
            {activeSeedings}
          </div>
          <div style={{ fontSize: '12px', color: D.textSub, marginTop: '6px' }}>Ordered + Shipped</div>
        </div>

        {/* Influencers */}
        <div style={{
          backgroundColor: D.surface, border: `1px solid ${D.border}`,
          borderRadius: '12px', padding: '22px 20px', boxShadow: D.shadow,
        }}>
          <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.8px', color: D.textMuted, marginBottom: '10px' }}>
            Influencers
          </div>
          <div style={{ fontSize: '38px', fontWeight: '800', color: D.purple, letterSpacing: '-1.5px', lineHeight: 1 }}>
            {totalInfluencers}
          </div>
          <div style={{ fontSize: '12px', color: D.textSub, marginTop: '6px' }}>Active roster</div>
        </div>
      </div>

      {/* ── Row 2: Bar chart + Pipeline ─────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '14px' }}>

        {/* Bar chart */}
        <div style={{
          backgroundColor: D.surface, border: `1px solid ${D.border}`,
          borderRadius: '12px', padding: '22px 24px', boxShadow: D.shadow,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
            <div>
              <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.8px', color: D.textMuted, marginBottom: '4px' }}>
                Seedings — Last 12 Weeks
              </div>
              <div style={{ fontSize: '22px', fontWeight: '800', color: D.text, letterSpacing: '-0.5px' }}>
                {weeks.reduce((s, w) => s + w.seedings, 0)} seedings
              </div>
            </div>
            <div style={{ fontSize: '12px', color: D.textMuted, textAlign: 'right' }}>
              €{fmtNum(weeks.reduce((s, w) => s + w.spend, 0))} value
            </div>
          </div>
          <BarChart weeks={weeks} />
          {/* X-axis labels — show every 3rd */}
          <div style={{ display: 'flex', gap: '5px', marginTop: '6px' }}>
            {weeks.map((w, i) => (
              <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: '9px', color: D.textMuted, overflow: 'hidden' }}>
                {i % 3 === 0 ? w.label : ''}
              </div>
            ))}
          </div>
        </div>

        {/* Pipeline funnel */}
        <div style={{
          backgroundColor: D.surface, border: `1px solid ${D.border}`,
          borderRadius: '12px', padding: '22px 24px', boxShadow: D.shadow,
        }}>
          <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.8px', color: D.textMuted, marginBottom: '16px' }}>
            Pipeline
          </div>
          {totalSeedings === 0 ? (
            <p style={{ margin: 0, color: D.textMuted, fontSize: '13px' }}>No seedings yet.</p>
          ) : (
            <>
              {/* Stacked bar */}
              <div style={{ display: 'flex', height: '6px', borderRadius: '99px', overflow: 'hidden', backgroundColor: D.surfaceHigh, marginBottom: '20px' }}>
                {statusPipeline.filter(s => s.count > 0).map(s => (
                  <div key={s.label} style={{ width: `${(s.count / totalSeedings) * 100}%`, backgroundColor: s.color }} />
                ))}
              </div>
              {/* Status rows */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {statusPipeline.map(s => (
                  <div key={s.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: s.color, flexShrink: 0 }} />
                      <span style={{ fontSize: '13px', color: D.textSub }}>{s.label}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{ width: '80px', height: '4px', backgroundColor: D.surfaceHigh, borderRadius: '99px', overflow: 'hidden' }}>
                        <div style={{ width: `${(s.count / totalSeedings) * 100}%`, height: '100%', backgroundColor: s.color, borderRadius: '99px' }} />
                      </div>
                      <span style={{ fontSize: '14px', fontWeight: '800', color: D.text, minWidth: '24px', textAlign: 'right' }}>{s.count}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: `1px solid ${D.border}`, fontSize: '12px', color: D.textMuted }}>
                {Math.round(((deliveredSeedings + postedSeedings) / totalSeedings) * 100)}% completion rate
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Row 3: Top Influencers ───────────────────────────────── */}
      <div style={{
        backgroundColor: D.surface, border: `1px solid ${D.border}`,
        borderRadius: '12px', boxShadow: D.shadow, overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: `1px solid ${D.border}` }}>
          <div style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.8px', color: D.textMuted }}>
            Top Influencers
          </div>
          <Link to="/portal/influencers" style={{ fontSize: '11px', color: D.accent, fontWeight: '700', textDecoration: 'none' }}>View all →</Link>
        </div>
        {topInfluencers.length === 0 ? (
          <div style={{ padding: '32px 24px', textAlign: 'center', color: D.textMuted, fontSize: '13px' }}>No influencers yet.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: D.bg }}>
                {['#', 'Influencer', 'Country', 'Followers', 'Seedings', 'Value Seeded'].map(h => (
                  <th key={h} style={{ textAlign: h === '#' ? 'center' : 'left', padding: '9px 20px', color: D.textMuted, fontWeight: '700', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.6px', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {topInfluencers.map((inf, i) => (
                <tr key={inf.id} style={{ borderTop: `1px solid ${D.borderLight}` }}>
                  <td style={{ padding: '13px 20px', textAlign: 'center', color: D.textMuted, fontSize: '12px', fontWeight: '700', width: '40px' }}>
                    {i + 1}
                  </td>
                  <td style={{ padding: '13px 20px' }}>
                    <Link to={`/portal/influencers/${inf.id}`} style={{ textDecoration: 'none' }}>
                      <div style={{ fontWeight: '700', color: D.text }}>{inf.name || `@${inf.handle}`}</div>
                      {inf.name && <div style={{ fontSize: '11px', color: D.textMuted, marginTop: '1px' }}>@{inf.handle}</div>}
                    </Link>
                  </td>
                  <td style={{ padding: '13px 20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                      <span style={{ fontSize: '18px', lineHeight: 1 }}>{getFlag(inf.country)}</span>
                      <span style={{ fontSize: '12px', color: D.textSub }}>{inf.country || '—'}</span>
                    </div>
                  </td>
                  <td style={{ padding: '13px 20px', color: D.textSub, fontSize: '12px', fontWeight: '600' }}>
                    {fmtFollowers(inf.followers)}
                  </td>
                  <td style={{ padding: '13px 20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ width: '60px', height: '4px', backgroundColor: D.surfaceHigh, borderRadius: '99px', overflow: 'hidden' }}>
                        <div style={{ width: `${(inf._count.seedings / (topInfluencers[0]._count.seedings || 1)) * 100}%`, height: '100%', backgroundColor: D.accent, borderRadius: '99px' }} />
                      </div>
                      <span style={{ fontSize: '13px', fontWeight: '700', color: D.text }}>{inf._count.seedings}</span>
                    </div>
                  </td>
                  <td style={{ padding: '13px 20px', fontWeight: '800', color: D.accent, fontSize: '13px' }}>
                    €{fmtNum(inf.totalSpend)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Row 4: Country breakdown ─────────────────────────────── */}
      {countryData.length > 0 && (
        <div style={{
          backgroundColor: D.surface, border: `1px solid ${D.border}`,
          borderRadius: '12px', boxShadow: D.shadow, overflow: 'hidden',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: `1px solid ${D.border}` }}>
            <div style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.8px', color: D.textMuted }}>
              Reach by Country
            </div>
            <div style={{ fontSize: '12px', color: D.textSub }}>
              {countryData.length} countr{countryData.length !== 1 ? 'ies' : 'y'} · €{fmtNum(totalCountrySpend)} total
            </div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: D.bg }}>
                {['Country', 'Influencers', 'Seedings', 'Value Seeded', 'Share'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '9px 24px', color: D.textMuted, fontWeight: '700', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.6px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {countryData.map((d, i) => {
                const pct = totalCountrySpend > 0 ? (d.spend / totalCountrySpend) * 100 : 0;
                return (
                  <tr key={d.country} style={{ borderTop: `1px solid ${D.borderLight}` }}>
                    <td style={{ padding: '12px 24px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '22px', lineHeight: 1 }}>{getFlag(d.country)}</span>
                        <span style={{ fontWeight: '700', color: D.text }}>{d.country}</span>
                      </div>
                    </td>
                    <td style={{ padding: '12px 24px', color: D.textSub, fontSize: '12px' }}>{d.influencers}</td>
                    <td style={{ padding: '12px 24px', color: D.textSub, fontSize: '12px' }}>{d.seedings}</td>
                    <td style={{ padding: '12px 24px', fontWeight: '800', color: D.text, fontSize: '13px' }}>€{fmtNum(d.spend)}</td>
                    <td style={{ padding: '12px 24px', width: '160px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ flex: 1, height: '5px', backgroundColor: D.surfaceHigh, borderRadius: '99px', overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', backgroundColor: D.accent, borderRadius: '99px' }} />
                        </div>
                        <span style={{ fontSize: '11px', fontWeight: '700', color: D.textMuted, minWidth: '32px', textAlign: 'right' }}>{Math.round(pct)}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Row 5: Recent Seedings ───────────────────────────────── */}
      <div style={{
        backgroundColor: D.surface, border: `1px solid ${D.border}`,
        borderRadius: '12px', boxShadow: D.shadow, overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: `1px solid ${D.border}` }}>
          <div style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.8px', color: D.textMuted }}>Recent Seedings</div>
          <Link to="/portal/seedings" style={{ fontSize: '11px', color: D.accent, fontWeight: '700', textDecoration: 'none' }}>View all →</Link>
        </div>
        {recentSeedings.length === 0 ? (
          <div style={{ padding: '40px 24px', textAlign: 'center', color: D.textMuted, fontSize: '13px' }}>No seedings yet.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: D.bg }}>
                {['Influencer', 'Campaign', 'Status', 'Value', 'Date'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '9px 24px', color: D.textMuted, fontWeight: '700', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.6px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentSeedings.map(s => (
                <tr key={s.id} style={{ borderTop: `1px solid ${D.borderLight}` }}>
                  <td style={{ padding: '12px 24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {s.influencer?.country && (
                        <span style={{ fontSize: '16px', lineHeight: 1 }}>{getFlag(s.influencer.country)}</span>
                      )}
                      <div>
                        <div style={{ fontWeight: '700', color: D.text }}>{s.influencer?.name || `@${s.influencer?.handle}`}</div>
                        {s.influencer?.name && s.influencer?.handle && (
                          <div style={{ fontSize: '11px', color: D.textMuted }}>@{s.influencer.handle}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '12px 24px', fontSize: '12px' }}>
                    {s.campaign
                      ? <Link to={`/portal/campaigns/${s.campaign.id}`} style={{ color: D.accent, fontWeight: '600', textDecoration: 'none' }}>{s.campaign.title}</Link>
                      : <span style={{ color: D.textMuted }}>—</span>}
                  </td>
                  <td style={{ padding: '12px 24px' }}><StatusPill status={s.status} /></td>
                  <td style={{ padding: '12px 24px', fontWeight: '700', color: D.text, fontSize: '13px' }}>
                    {s.totalCost ? `€${fmtNum(s.totalCost)}` : '—'}
                  </td>
                  <td style={{ padding: '12px 24px', color: D.textSub, fontSize: '12px' }}>{fmtDate(s.createdAt, 'medium')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

    </div>
  );
}
