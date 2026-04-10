import { useState } from 'react';
import { useLoaderData } from 'react-router';
import prisma from '../db.server';
import { requirePortalUser } from '../utils/portal-auth.server';
import { requirePermission } from '../utils/portal-permissions';
import { fmtNum } from '../theme';

const D = {
  bg:          '#F7F8FA',
  surface:     '#FFFFFF',
  surfaceHigh: '#F3F4F6',
  border:      '#E8E9EC',
  borderLight: '#F0F1F3',
  accent:      '#7C6FF7',
  text:        '#111827',
  textSub:     '#6B7280',
  textMuted:   '#9CA3AF',
  shadow:      '0 1px 3px rgba(0,0,0,0.06)',
};

export async function loader({ request }) {
  const { portalUser } = await requirePortalUser(request);
  requirePermission(portalUser.role, 'viewInfluencers');
  const influencers = await prisma.influencer.findMany({
    where:   { archived: false },
    orderBy: { name: 'asc' },
    include: { _count: { select: { seedings: true } } },
  });
  return { influencers, role: portalUser.role };
}

export default function PortalInfluencers() {
  const { influencers } = useLoaderData();
  const [q, setQ] = useState('');

  const filtered = influencers.filter(inf =>
    !q ||
    inf.name?.toLowerCase().includes(q.toLowerCase()) ||
    inf.handle?.toLowerCase().includes(q.toLowerCase()) ||
    inf.country?.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div style={{ display: 'grid', gap: '20px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: D.text, letterSpacing: '-0.3px' }}>
            Influencers
          </h2>
          <p style={{ margin: '2px 0 0', fontSize: '13px', color: D.textSub }}>
            {influencers.length} active influencer{influencers.length !== 1 ? 's' : ''}
          </p>
        </div>
        <input
          type="text"
          placeholder="Search by name, handle or country…"
          value={q}
          onChange={e => setQ(e.target.value)}
          style={{
            padding: '7px 12px',
            border: `1px solid ${D.border}`,
            borderRadius: '7px',
            fontSize: '13px',
            width: '260px',
            backgroundColor: D.surface,
            color: D.text,
          }}
        />
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: D.textMuted, border: `2px dashed ${D.border}`, borderRadius: '12px' }}>
          <p style={{ margin: 0 }}>No influencers found.</p>
        </div>
      ) : (
        <div style={{ backgroundColor: D.surface, border: `1px solid ${D.border}`, borderRadius: '12px', boxShadow: D.shadow, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: D.bg }}>
                {['Handle', 'Name', 'Followers', 'Country', 'Email', 'Seedings'].map(h => (
                  <th key={h} style={{
                    padding: '10px 16px', textAlign: 'left',
                    fontWeight: '700', fontSize: '10px',
                    textTransform: 'uppercase', letterSpacing: '0.7px',
                    color: D.textMuted,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((inf, i) => (
                <tr key={inf.id} style={{ borderTop: `1px solid ${D.borderLight}` }}>
                  <td style={{ padding: '12px 16px', fontWeight: '700', color: D.accent }}>
                    @{inf.handle}
                  </td>
                  <td style={{ padding: '12px 16px', fontWeight: '600', color: D.text }}>
                    {inf.name || <span style={{ color: D.textMuted }}>—</span>}
                  </td>
                  <td style={{ padding: '12px 16px', color: D.textSub }}>
                    {inf.followers ? fmtNum(inf.followers) : <span style={{ color: D.textMuted }}>—</span>}
                  </td>
                  <td style={{ padding: '12px 16px', color: D.textSub }}>
                    {inf.country || <span style={{ color: D.textMuted }}>—</span>}
                  </td>
                  <td style={{ padding: '12px 16px', color: D.textSub, fontSize: '12px' }}>
                    {inf.email ? (
                      <a href={`mailto:${inf.email}`} style={{ color: D.accent, textDecoration: 'none' }}>{inf.email}</a>
                    ) : (
                      <span style={{ color: D.textMuted }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{
                      display: 'inline-block',
                      backgroundColor: inf._count.seedings > 0 ? '#EEF0FE' : D.surfaceHigh,
                      color: inf._count.seedings > 0 ? D.accent : D.textMuted,
                      borderRadius: '6px', padding: '2px 10px',
                      fontSize: '12px', fontWeight: '700',
                    }}>
                      {inf._count.seedings}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
