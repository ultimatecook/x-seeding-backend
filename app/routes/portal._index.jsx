import { useLoaderData, Link } from 'react-router';
import prisma from '../db.server';
import { requirePortalUser } from '../utils/portal-auth.server';
import { C, card, fmtDate } from '../theme';

export async function loader({ request }) {
  const { shop } = await requirePortalUser(request);

  const [totalSeedings, pendingSeedings, totalInfluencers, recentSeedings] = await Promise.all([
    prisma.seeding.count({ where: { shop } }),
    prisma.seeding.count({ where: { shop, status: 'Pending' } }),
    prisma.influencer.count({ where: { archived: false } }),
    prisma.seeding.findMany({
      where:   { shop },
      include: { influencer: true },
      orderBy: { createdAt: 'desc' },
      take:    5,
    }),
  ]);

  return { totalSeedings, pendingSeedings, totalInfluencers, recentSeedings };
}

const STATUS_COLORS = {
  Pending:   { bg: '#FEF3C7', text: '#92400E' },
  Ordered:   { bg: '#DBEAFE', text: '#1E40AF' },
  Shipped:   { bg: '#EDE9FE', text: '#5B21B6' },
  Delivered: { bg: '#D1FAE5', text: '#065F46' },
  Posted:    { bg: '#FCE7F3', text: '#9D174D' },
};

export default function PortalDashboard() {
  const { totalSeedings, pendingSeedings, totalInfluencers, recentSeedings } = useLoaderData();

  const stats = [
    { label: 'Total Seedings', value: totalSeedings },
    { label: 'Pending', value: pendingSeedings },
    { label: 'Influencers', value: totalInfluencers },
  ];

  return (
    <div style={{ display: 'grid', gap: '24px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
        {stats.map(s => (
          <div key={s.label} style={{ ...card.base, textAlign: 'center' }}>
            <div style={{ fontSize: '28px', fontWeight: '800', color: C.text }}>{s.value}</div>
            <div style={{ fontSize: '12px', color: C.textSub, marginTop: '4px', fontWeight: '600' }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={card.base}>
        <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: '700', color: C.text }}>
          Recent Seedings
        </h3>
        {recentSeedings.length === 0 ? (
          <p style={{ margin: 0, color: C.textSub, fontSize: '13px' }}>No seedings yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {['Influencer', 'Status', 'Date'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '6px 8px', color: C.textSub, fontWeight: '600', fontSize: '11px', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentSeedings.map(s => {
                const sc = STATUS_COLORS[s.status] || { bg: '#F3F4F6', text: '#374151' };
                return (
                  <tr key={s.id} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                    <td style={{ padding: '10px 8px', fontWeight: '600', color: C.text }}>
                      {s.influencer?.name || s.influencer?.handle}
                    </td>
                    <td style={{ padding: '10px 8px' }}>
                      <span style={{ backgroundColor: sc.bg, color: sc.text, borderRadius: '4px', padding: '2px 8px', fontSize: '11px', fontWeight: '700' }}>
                        {s.status}
                      </span>
                    </td>
                    <td style={{ padding: '10px 8px', color: C.textSub }}>{fmtDate(s.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div style={{ marginTop: '12px' }}>
          <Link to="/portal/seedings" style={{ fontSize: '13px', color: C.accent, fontWeight: '700', textDecoration: 'none' }}>
            View all seedings →
          </Link>
        </div>
      </div>
    </div>
  );
}
