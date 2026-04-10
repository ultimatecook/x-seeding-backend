import { useLoaderData, Link } from 'react-router';
import prisma from '../db.server';
import { requirePortalUser } from '../utils/portal-auth.server';
import { fmtDate, fmtNum } from '../theme';
import { D } from '../utils/portal-theme';

export async function loader({ request }) {
  const { shop } = await requirePortalUser(request);

  const [
    totalSeedings,
    pendingSeedings,
    orderedSeedings,
    shippedSeedings,
    deliveredSeedings,
    postedSeedings,
    totalInfluencers,
    recentSeedings,
    topInfluencers,
    seedingsWithCountry,
  ] = await Promise.all([
    prisma.seeding.count({ where: { shop } }),
    prisma.seeding.count({ where: { shop, status: 'Pending' } }),
    prisma.seeding.count({ where: { shop, status: 'Ordered' } }),
    prisma.seeding.count({ where: { shop, status: 'Shipped' } }),
    prisma.seeding.count({ where: { shop, status: 'Delivered' } }),
    prisma.seeding.count({ where: { shop, status: 'Posted' } }),
    prisma.influencer.count({ where: { archived: false } }),
    prisma.seeding.findMany({
      where:   { shop },
      include: { influencer: true, campaign: true },
      orderBy: { createdAt: 'desc' },
      take:    8,
    }),
    prisma.influencer.findMany({
      where:   { archived: false },
      orderBy: { seedings: { _count: 'desc' } },
      take:    5,
      include: { _count: { select: { seedings: true } } },
    }),
    // For country breakdown
    prisma.seeding.findMany({
      where:   { shop },
      include: { influencer: { select: { country: true } }, products: { select: { price: true } } },
    }),
  ]);

  // Build country stats
  const countryMap = {};
  for (const s of seedingsWithCountry) {
    const c = s.influencer?.country || 'Unknown';
    if (!countryMap[c]) countryMap[c] = { seedings: 0, spend: 0, influencers: new Set() };
    countryMap[c].seedings++;
    countryMap[c].spend += s.totalCost ?? s.products.reduce((sum, p) => sum + (p.price ?? 0), 0);
    if (s.influencerId) countryMap[c].influencers.add(s.influencerId);
  }
  const countryData = Object.entries(countryMap)
    .map(([country, d]) => ({ country, seedings: d.seedings, spend: d.spend, influencers: d.influencers.size }))
    .sort((a, b) => b.seedings - a.seedings);

  return {
    totalSeedings, pendingSeedings, orderedSeedings,
    shippedSeedings, deliveredSeedings, postedSeedings,
    totalInfluencers, recentSeedings, topInfluencers, countryData,
  };
}

// ── Design tokens ─────────────────────────────────────────────────────────────

const STATUS_META = {
  Pending:   { bg: D.statusPending.bg,   text: D.statusPending.color,   dot: D.statusPending.dot   },
  Ordered:   { bg: D.statusOrdered.bg,   text: D.statusOrdered.color,   dot: D.statusOrdered.dot   },
  Shipped:   { bg: D.statusShipped.bg,   text: D.statusShipped.color,   dot: D.statusShipped.dot   },
  Delivered: { bg: D.statusDelivered.bg, text: D.statusDelivered.color, dot: D.statusDelivered.dot },
  Posted:    { bg: D.statusPosted.bg,    text: D.statusPosted.color,    dot: D.statusPosted.dot    },
};


// Country ISO codes → emoji flag
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

function KpiCard({ label, value, sub }) {
  return (
    <div style={{
      backgroundColor: D.surface, border: `1px solid ${D.border}`,
      borderRadius: '12px', padding: '20px 22px', boxShadow: D.shadow,
    }}>
      <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.8px', color: D.textMuted, marginBottom: '8px' }}>
        {label}
      </div>
      <div style={{ fontSize: '30px', fontWeight: '800', color: D.text, letterSpacing: '-1px', lineHeight: 1.1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: '12px', color: D.textSub, marginTop: '5px', fontWeight: '500' }}>{sub}</div>}
    </div>
  );
}

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

export default function PortalDashboard() {
  const {
    totalSeedings, pendingSeedings, orderedSeedings,
    shippedSeedings, deliveredSeedings, postedSeedings,
    totalInfluencers, recentSeedings, topInfluencers, countryData,
  } = useLoaderData();

  const activeSeedings    = orderedSeedings + shippedSeedings;
  const completedSeedings = deliveredSeedings + postedSeedings;
  const maxCountrySeedings = countryData[0]?.seedings || 1;
  const totalCountrySeedings = countryData.reduce((s, d) => s + d.seedings, 0);

  const statusBreakdown = [
    { label: 'Pending',   count: pendingSeedings,   color: D.statusPending.dot },
    { label: 'Ordered',   count: orderedSeedings,   color: D.statusOrdered.dot },
    { label: 'Shipped',   count: shippedSeedings,   color: D.statusDelivered.dot },
    { label: 'Delivered', count: deliveredSeedings, color: D.statusDelivered.dot },
    { label: 'Posted',    count: postedSeedings,    color: D.purple },
  ].filter(s => s.count > 0);

  return (
    <div style={{ display: 'grid', gap: '20px' }}>

      {/* ── KPI Row ───────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
        <KpiCard label="Total Seedings"  value={totalSeedings}    sub="All time" />
        <KpiCard label="Pending"         value={pendingSeedings}  sub="Awaiting order" />
        <KpiCard label="In Transit"      value={activeSeedings}   sub="Ordered + Shipped" />
        <KpiCard label="Influencers"     value={totalInfluencers} sub="Active roster" />
      </div>

      {/* ── Middle row: Pipeline + Top Influencers ────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '14px' }}>

        {/* Pipeline */}
        <div style={{ backgroundColor: D.surface, border: `1px solid ${D.border}`, borderRadius: '12px', padding: '22px 24px', boxShadow: D.shadow }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h3 style={{ margin: 0, fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.8px', color: D.textMuted }}>Seeding Pipeline</h3>
            <span style={{ fontSize: '11px', color: D.textMuted, fontWeight: '600' }}>{totalSeedings} total</span>
          </div>
          {totalSeedings === 0 ? (
            <p style={{ margin: 0, color: D.textMuted, fontSize: '13px' }}>No seedings yet.</p>
          ) : (
            <>
              <div style={{ display: 'flex', height: '8px', borderRadius: '99px', overflow: 'hidden', marginBottom: '20px', backgroundColor: D.surfaceHigh }}>
                {statusBreakdown.map(s => (
                  <div key={s.label} style={{ width: `${(s.count / totalSeedings) * 100}%`, backgroundColor: s.color }} />
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px' }}>
                {[
                  { label: 'Pending',   count: pendingSeedings,   color: D.statusPending.dot },
                  { label: 'Ordered',   count: orderedSeedings,   color: D.statusOrdered.dot },
                  { label: 'Shipped',   count: shippedSeedings,   color: D.statusDelivered.dot },
                  { label: 'Delivered', count: deliveredSeedings, color: D.statusDelivered.dot },
                  { label: 'Posted',    count: postedSeedings,    color: D.purple },
                ].map(s => (
                  <div key={s.label} style={{ padding: '10px 12px', borderRadius: '8px', backgroundColor: D.surfaceHigh }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '6px' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: s.color, flexShrink: 0 }} />
                      <span style={{ fontSize: '10px', fontWeight: '700', color: D.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{s.label}</span>
                    </div>
                    <span style={{ fontSize: '22px', fontWeight: '800', color: D.text, letterSpacing: '-0.5px' }}>{s.count}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Top Influencers */}
        <div style={{ backgroundColor: D.surface, border: `1px solid ${D.border}`, borderRadius: '12px', padding: '22px 24px', boxShadow: D.shadow }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.8px', color: D.textMuted }}>Top Influencers</h3>
            <Link to="/portal/influencers" style={{ fontSize: '11px', color: D.accent, fontWeight: '700', textDecoration: 'none' }}>View all →</Link>
          </div>
          {topInfluencers.length === 0 ? (
            <p style={{ margin: 0, color: D.textMuted, fontSize: '13px' }}>No influencers yet.</p>
          ) : (
            <div style={{ display: 'grid', gap: '2px' }}>
              {topInfluencers.map((inf, i) => {
                const maxCount = topInfluencers[0]._count.seedings || 1;
                const pct = (inf._count.seedings / maxCount) * 100;
                return (
                  <div key={inf.id} style={{ display: 'grid', gridTemplateColumns: '20px 1fr auto', alignItems: 'center', gap: '10px', padding: '9px 0', borderBottom: i < topInfluencers.length - 1 ? `1px solid ${D.borderLight}` : 'none' }}>
                    <span style={{ fontSize: '11px', fontWeight: '700', color: D.textMuted }}>{i + 1}</span>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: '700', color: D.text, marginBottom: '4px' }}>{inf.name || `@${inf.handle}`}</div>
                      <div style={{ height: '4px', borderRadius: '99px', backgroundColor: D.surfaceHigh }}>
                        <div style={{ width: `${pct}%`, height: '100%', backgroundColor: D.accent, borderRadius: '99px' }} />
                      </div>
                    </div>
                    <span style={{ fontSize: '13px', fontWeight: '700', color: D.text }}>{inf._count.seedings}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Country breakdown (Stripe-style) ──────────────────── */}
      {countryData.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>

          {/* Left: big number + country rows */}
          <div style={{
            backgroundColor: D.surface, border: `1px solid ${D.border}`,
            borderRadius: '12px', padding: '24px', boxShadow: D.shadow,
          }}>
            {/* Header stat — Stripe-style */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
              <div>
                <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.8px', color: D.textMuted, marginBottom: '8px' }}>
                  Reach by Country
                </div>
                <div style={{ fontSize: '36px', fontWeight: '800', color: D.text, letterSpacing: '-1.5px', lineHeight: 1 }}>
                  {countryData.length}
                </div>
                <div style={{ fontSize: '13px', color: D.textSub, marginTop: '4px' }}>
                  {totalCountrySeedings} seedings across {countryData.length} countr{countryData.length !== 1 ? 'ies' : 'y'}
                </div>
              </div>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                backgroundColor: D.accentLight, borderRadius: '8px',
                padding: '6px 12px',
              }}>
                <span style={{ fontSize: '13px' }}>🌍</span>
                <span style={{ fontSize: '12px', fontWeight: '700', color: D.accent }}>Global</span>
              </div>
            </div>

            {/* Country rows */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {countryData.slice(0, 8).map((d, i) => {
                const pct = Math.round((d.seedings / totalCountrySeedings) * 100);
                return (
                  <div key={d.country}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '7px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '22px', lineHeight: 1, flexShrink: 0 }}>{getFlag(d.country)}</span>
                        <div>
                          <div style={{ fontSize: '13px', fontWeight: '700', color: D.text }}>{d.country}</div>
                          <div style={{ fontSize: '11px', color: D.textMuted, marginTop: '1px' }}>
                            {d.seedings} seeding{d.seedings !== 1 ? 's' : ''} · {d.influencers} influencer{d.influencers !== 1 ? 's' : ''}
                          </div>
                        </div>
                      </div>
                      <span style={{ fontSize: '14px', fontWeight: '800', color: D.text, letterSpacing: '-0.3px' }}>
                        {pct}%
                      </span>
                    </div>
                    {/* Progress bar */}
                    <div style={{ height: '6px', backgroundColor: D.surfaceHigh, borderRadius: '99px', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: `${pct}%`,
                        borderRadius: '99px',
                        background: `linear-gradient(90deg, ${D.accent} 0%, #9C8FFF 100%)`,
                        transition: 'width 0.4s ease',
                      }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: spend leaderboard (Stripe-style card) */}
          <div style={{
            backgroundColor: D.surface, border: `1px solid ${D.border}`,
            borderRadius: '12px', padding: '24px', boxShadow: D.shadow,
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.8px', color: D.textMuted, marginBottom: '6px' }}>
              Investment by Country
            </div>
            <div style={{ fontSize: '36px', fontWeight: '800', color: D.text, letterSpacing: '-1.5px', lineHeight: 1, marginBottom: '4px' }}>
              €{fmtNum(countryData.reduce((s, d) => s + d.spend, 0))}
            </div>
            <div style={{ fontSize: '13px', color: D.textSub, marginBottom: '24px' }}>
              Total retail value seeded
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
              {countryData.slice(0, 7).map((d, i) => {
                const totalSpend = countryData.reduce((s, x) => s + x.spend, 0);
                const pct = totalSpend > 0 ? Math.round((d.spend / totalSpend) * 100) : 0;
                const COLORS = [D.accent, D.purple, D.statusDelivered.dot, D.statusShipped.dot, D.statusPending.dot, D.statusOrdered.dot, D.purpleLight];
                const color  = COLORS[i % COLORS.length];
                return (
                  <div key={d.country}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '18px', lineHeight: 1 }}>{getFlag(d.country)}</span>
                        <span style={{ fontSize: '13px', fontWeight: '700', color: D.text }}>{d.country}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '13px', fontWeight: '800', color }}> €{fmtNum(d.spend)}</span>
                        <span style={{ fontSize: '11px', color: D.textMuted, minWidth: '30px', textAlign: 'right' }}>{pct}%</span>
                      </div>
                    </div>
                    <div style={{ height: '5px', backgroundColor: D.surfaceHigh, borderRadius: '99px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, backgroundColor: color, borderRadius: '99px', transition: 'width 0.4s ease' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Recent Seedings ────────────────────────────────────── */}
      <div style={{ backgroundColor: D.surface, border: `1px solid ${D.border}`, borderRadius: '12px', boxShadow: D.shadow, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: `1px solid ${D.border}` }}>
          <h3 style={{ margin: 0, fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.8px', color: D.textMuted }}>Recent Seedings</h3>
          <Link to="/portal/seedings" style={{ fontSize: '12px', color: D.accent, fontWeight: '700', textDecoration: 'none' }}>View all →</Link>
        </div>
        {recentSeedings.length === 0 ? (
          <div style={{ padding: '40px 24px', textAlign: 'center', color: D.textMuted, fontSize: '13px' }}>No seedings yet.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: D.bg }}>
                {['Influencer', 'Campaign', 'Status', 'Date'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 24px', color: D.textMuted, fontWeight: '700', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.7px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentSeedings.map((s, i) => (
                <tr key={s.id} style={{ borderTop: `1px solid ${D.borderLight}` }}>
                  <td style={{ padding: '13px 24px' }}>
                    <div style={{ fontWeight: '700', color: D.text }}>{s.influencer?.name || `@${s.influencer?.handle}`}</div>
                    {s.influencer?.name && s.influencer?.handle && (
                      <div style={{ fontSize: '11px', color: D.textMuted, marginTop: '1px' }}>@{s.influencer.handle}</div>
                    )}
                  </td>
                  <td style={{ padding: '13px 24px', fontSize: '12px' }}>
                    {s.campaign ? (
                      <Link to={`/portal/campaigns/${s.campaign.id}`} style={{ color: D.accent, fontWeight: '600', textDecoration: 'none' }}>{s.campaign.title}</Link>
                    ) : <span style={{ color: D.textMuted }}>—</span>}
                  </td>
                  <td style={{ padding: '13px 24px' }}><StatusPill status={s.status} /></td>
                  <td style={{ padding: '13px 24px', color: D.textSub, fontSize: '12px' }}>{fmtDate(s.createdAt, 'medium')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

    </div>
  );
}
