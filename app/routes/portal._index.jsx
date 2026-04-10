import { useLoaderData, Link } from 'react-router';
import prisma from '../db.server';
import { requirePortalUser } from '../utils/portal-auth.server';
import { fmtDate, fmtNum } from '../theme';

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
    // top influencers by seeding count
    prisma.influencer.findMany({
      where:    { archived: false },
      orderBy:  { seedings: { _count: 'desc' } },
      take:     5,
      include:  { _count: { select: { seedings: true } } },
    }),
  ]);

  return {
    totalSeedings, pendingSeedings, orderedSeedings,
    shippedSeedings, deliveredSeedings, postedSeedings,
    totalInfluencers, recentSeedings, topInfluencers,
  };
}

// ── Design tokens (inline for dashboard isolation) ───────────────────────────
const D = {
  bg:          '#F7F8FA',
  surface:     '#FFFFFF',
  surfaceHigh: '#F3F4F6',
  border:      '#E8E9EC',
  borderLight: '#F0F1F3',
  accent:      '#7C6FF7',   // purple like Salepol reference
  accentLight: '#EEF0FE',
  text:        '#111827',
  textSub:     '#6B7280',
  textMuted:   '#9CA3AF',
  shadow:      '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
  shadowMd:    '0 4px 12px rgba(0,0,0,0.07)',
};

const STATUS_META = {
  Pending:   { bg: '#FFFBEB', text: '#B45309', dot: '#F59E0B' },
  Ordered:   { bg: '#EFF6FF', text: '#1D4ED8', dot: '#3B82F6' },
  Shipped:   { bg: '#F0FDF4', text: '#15803D', dot: '#22C55E' },
  Delivered: { bg: '#F0FDFA', text: '#0F766E', dot: '#14B8A6' },
  Posted:    { bg: '#FDF4FF', text: '#7E22CE', dot: '#A855F7' },
};

function KpiCard({ label, value, sub, color = D.accent }) {
  return (
    <div style={{
      backgroundColor: D.surface,
      border: `1px solid ${D.border}`,
      borderRadius: '12px',
      padding: '20px 22px',
      boxShadow: D.shadow,
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
    }}>
      <span style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.8px', color: D.textMuted }}>
        {label}
      </span>
      <span style={{ fontSize: '30px', fontWeight: '800', color: D.text, letterSpacing: '-1px', lineHeight: 1.1 }}>
        {value}
      </span>
      {sub && (
        <span style={{ fontSize: '12px', color: D.textSub, fontWeight: '500' }}>{sub}</span>
      )}
    </div>
  );
}

function StatusPill({ status }) {
  const m = STATUS_META[status] || { bg: '#F3F4F6', text: '#374151', dot: '#9CA3AF' };
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
    totalInfluencers, recentSeedings, topInfluencers,
  } = useLoaderData();

  const activeSeedings = orderedSeedings + shippedSeedings;
  const completedSeedings = deliveredSeedings + postedSeedings;

  // status breakdown bar
  const statusBreakdown = [
    { label: 'Pending',   count: pendingSeedings,   color: '#F59E0B' },
    { label: 'Ordered',   count: orderedSeedings,   color: '#3B82F6' },
    { label: 'Shipped',   count: shippedSeedings,   color: '#22C55E' },
    { label: 'Delivered', count: deliveredSeedings, color: '#14B8A6' },
    { label: 'Posted',    count: postedSeedings,    color: '#A855F7' },
  ].filter(s => s.count > 0);

  return (
    <div style={{ display: 'grid', gap: '20px' }}>

      {/* ── KPI Row ──────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
        <KpiCard label="Total Seedings" value={totalSeedings} sub="All time" />
        <KpiCard label="Pending" value={pendingSeedings} sub="Awaiting order" color="#F59E0B" />
        <KpiCard label="In Transit" value={activeSeedings} sub="Ordered + Shipped" color="#3B82F6" />
        <KpiCard label="Influencers" value={totalInfluencers} sub="Active roster" color="#22C55E" />
      </div>

      {/* ── Status pipeline + Top influencers ────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '14px' }}>

        {/* Pipeline card */}
        <div style={{
          backgroundColor: D.surface, border: `1px solid ${D.border}`,
          borderRadius: '12px', padding: '22px 24px', boxShadow: D.shadow,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h3 style={{ margin: 0, fontSize: '13px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.7px', color: D.textSub }}>
              Seeding Pipeline
            </h3>
            <span style={{ fontSize: '11px', color: D.textMuted, fontWeight: '600' }}>
              {totalSeedings} total
            </span>
          </div>

          {totalSeedings === 0 ? (
            <p style={{ margin: 0, color: D.textMuted, fontSize: '13px' }}>No seedings yet.</p>
          ) : (
            <>
              {/* Stacked progress bar */}
              <div style={{ display: 'flex', height: '8px', borderRadius: '99px', overflow: 'hidden', marginBottom: '20px', backgroundColor: D.surfaceHigh }}>
                {statusBreakdown.map(s => (
                  <div key={s.label} style={{
                    width: `${(s.count / totalSeedings) * 100}%`,
                    backgroundColor: s.color,
                    transition: 'width 0.3s',
                  }} />
                ))}
              </div>

              {/* Legend */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px' }}>
                {[
                  { label: 'Pending',   count: pendingSeedings,   color: '#F59E0B' },
                  { label: 'Ordered',   count: orderedSeedings,   color: '#3B82F6' },
                  { label: 'Shipped',   count: shippedSeedings,   color: '#22C55E' },
                  { label: 'Delivered', count: deliveredSeedings, color: '#14B8A6' },
                  { label: 'Posted',    count: postedSeedings,    color: '#A855F7' },
                ].map(s => (
                  <div key={s.label} style={{
                    display: 'flex', flexDirection: 'column', gap: '4px',
                    padding: '10px 12px', borderRadius: '8px',
                    backgroundColor: D.surfaceHigh,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
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

        {/* Top influencers card */}
        <div style={{
          backgroundColor: D.surface, border: `1px solid ${D.border}`,
          borderRadius: '12px', padding: '22px 24px', boxShadow: D.shadow,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '13px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.7px', color: D.textSub }}>
              Top Influencers
            </h3>
            <Link to="/portal/influencers" style={{ fontSize: '11px', color: D.accent, fontWeight: '700', textDecoration: 'none' }}>
              View all →
            </Link>
          </div>

          {topInfluencers.length === 0 ? (
            <p style={{ margin: 0, color: D.textMuted, fontSize: '13px' }}>No influencers yet.</p>
          ) : (
            <div style={{ display: 'grid', gap: '2px' }}>
              {topInfluencers.map((inf, i) => {
                const maxCount = topInfluencers[0]._count.seedings || 1;
                const pct = (inf._count.seedings / maxCount) * 100;
                return (
                  <div key={inf.id} style={{ display: 'grid', alignItems: 'center', gap: '10px', padding: '9px 0', borderBottom: i < topInfluencers.length - 1 ? `1px solid ${D.borderLight}` : 'none', gridTemplateColumns: '20px 1fr auto' }}>
                    <span style={{ fontSize: '11px', fontWeight: '700', color: D.textMuted }}>{i + 1}</span>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: '700', color: D.text, marginBottom: '4px' }}>
                        {inf.name || `@${inf.handle}`}
                      </div>
                      <div style={{ height: '4px', borderRadius: '99px', backgroundColor: D.surfaceHigh, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', backgroundColor: D.accent, borderRadius: '99px' }} />
                      </div>
                    </div>
                    <span style={{ fontSize: '13px', fontWeight: '700', color: D.text, minWidth: '24px', textAlign: 'right' }}>
                      {inf._count.seedings}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Recent seedings table ─────────────────────────────── */}
      <div style={{
        backgroundColor: D.surface, border: `1px solid ${D.border}`,
        borderRadius: '12px', boxShadow: D.shadow, overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '18px 24px', borderBottom: `1px solid ${D.border}`,
        }}>
          <h3 style={{ margin: 0, fontSize: '13px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.7px', color: D.textSub }}>
            Recent Seedings
          </h3>
          <Link to="/portal/seedings" style={{ fontSize: '12px', color: D.accent, fontWeight: '700', textDecoration: 'none' }}>
            View all →
          </Link>
        </div>

        {recentSeedings.length === 0 ? (
          <div style={{ padding: '40px 24px', textAlign: 'center', color: D.textMuted, fontSize: '13px' }}>
            No seedings yet.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: D.bg }}>
                {['Influencer', 'Campaign', 'Status', 'Date'].map(h => (
                  <th key={h} style={{
                    textAlign: 'left', padding: '10px 24px',
                    color: D.textMuted, fontWeight: '700',
                    fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.7px',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentSeedings.map((s, i) => (
                <tr key={s.id} style={{
                  borderBottom: i < recentSeedings.length - 1 ? `1px solid ${D.borderLight}` : 'none',
                  transition: 'background 0.1s',
                }}>
                  <td style={{ padding: '13px 24px' }}>
                    <div style={{ fontWeight: '700', color: D.text }}>
                      {s.influencer?.name || `@${s.influencer?.handle}`}
                    </div>
                    {s.influencer?.handle && s.influencer?.name && (
                      <div style={{ fontSize: '11px', color: D.textMuted, marginTop: '1px' }}>
                        @{s.influencer.handle}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '13px 24px', fontSize: '12px' }}>
                    {s.campaign ? (
                      <Link
                        to={`/portal/seedings?campaign=${s.campaign.id}`}
                        style={{ color: D.accent, fontWeight: '600', textDecoration: 'none' }}
                      >
                        {s.campaign.title}
                      </Link>
                    ) : (
                      <span style={{ color: D.textMuted }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: '13px 24px' }}>
                    <StatusPill status={s.status} />
                  </td>
                  <td style={{ padding: '13px 24px', color: D.textSub, fontSize: '12px', fontWeight: '500' }}>
                    {fmtDate(s.createdAt, 'medium')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

    </div>
  );
}
