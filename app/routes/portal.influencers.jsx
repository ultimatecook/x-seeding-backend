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
  accentLight: '#EEF0FE',
  text:        '#111827',
  textSub:     '#6B7280',
  textMuted:   '#9CA3AF',
  shadow:      '0 1px 3px rgba(0,0,0,0.06)',
};

export async function loader({ request }) {
  const { portalUser } = await requirePortalUser(request);
  requirePermission(portalUser.role, 'viewInfluencers');

  // Load both active and archived so client can filter without a round-trip
  const influencers = await prisma.influencer.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { seedings: true } } },
  });
  return { influencers, role: portalUser.role };
}

export default function PortalInfluencers() {
  const { influencers } = useLoaderData();
  const [q,          setQ]          = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [country,    setCountry]    = useState('all');

  // All unique countries from active influencers
  const allCountries = [...new Set(
    influencers.filter(i => !i.archived).map(i => i.country).filter(Boolean)
  )].sort();

  const filtered = influencers.filter(inf => {
    if (!showArchived && inf.archived) return false;
    if (showArchived && !inf.archived) return false;
    if (country !== 'all' && inf.country !== country) return false;
    if (q && !inf.name?.toLowerCase().includes(q.toLowerCase()) &&
             !inf.handle?.toLowerCase().includes(q.toLowerCase()) &&
             !inf.country?.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const activeCount   = influencers.filter(i => !i.archived).length;
  const archivedCount = influencers.filter(i => i.archived).length;

  return (
    <div style={{ display: 'grid', gap: '20px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: D.text, letterSpacing: '-0.3px' }}>
            Influencers
          </h2>
          <p style={{ margin: '2px 0 0', fontSize: '13px', color: D.textSub }}>
            {filtered.length} shown
          </p>
        </div>
        <input
          type="text"
          placeholder="Search name, handle, country…"
          value={q}
          onChange={e => setQ(e.target.value)}
          style={{
            padding: '7px 12px', border: `1px solid ${D.border}`,
            borderRadius: '7px', fontSize: '13px', width: '240px',
            backgroundColor: D.surface, color: D.text,
          }}
        />
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>

        {/* Active / Archived toggle */}
        <div style={{ display: 'flex', backgroundColor: D.surfaceHigh, borderRadius: '8px', padding: '3px', gap: '2px' }}>
          {[
            { label: `Active · ${activeCount}`,   value: false },
            { label: `Archived · ${archivedCount}`, value: true  },
          ].map(opt => (
            <button key={String(opt.value)} type="button" onClick={() => { setShowArchived(opt.value); setCountry('all'); }}
              style={{
                padding: '5px 14px', fontSize: '12px', fontWeight: '700',
                border: 'none', cursor: 'pointer', borderRadius: '6px',
                backgroundColor: showArchived === opt.value ? D.surface : 'transparent',
                color: showArchived === opt.value ? D.text : D.textMuted,
                boxShadow: showArchived === opt.value ? D.shadow : 'none',
                transition: 'all 0.12s',
              }}>
              {opt.label}
            </button>
          ))}
        </div>

        {/* Country pills — only show for active */}
        {!showArchived && allCountries.length > 1 && (
          <>
            <button type="button" onClick={() => setCountry('all')} style={{
              padding: '5px 14px', fontSize: '12px', fontWeight: '600', borderRadius: '20px', cursor: 'pointer',
              border: `1.5px solid ${country === 'all' ? D.accent : D.border}`,
              backgroundColor: country === 'all' ? D.accent : 'transparent',
              color: country === 'all' ? '#fff' : D.textSub,
            }}>All countries</button>
            {allCountries.map(c => (
              <button key={c} type="button" onClick={() => setCountry(country === c ? 'all' : c)} style={{
                padding: '5px 14px', fontSize: '12px', fontWeight: '600', borderRadius: '20px', cursor: 'pointer',
                border: `1.5px solid ${country === c ? D.accent : D.border}`,
                backgroundColor: country === c ? D.accentLight : 'transparent',
                color: country === c ? D.accent : D.textSub,
              }}>{c}</button>
            ))}
          </>
        )}

        {/* Clear search */}
        {q && (
          <button type="button" onClick={() => setQ('')} style={{
            marginLeft: 'auto', padding: '5px 12px', fontSize: '12px', fontWeight: '600',
            borderRadius: '7px', border: `1px solid ${D.border}`, backgroundColor: 'transparent',
            color: D.textSub, cursor: 'pointer',
          }}>Clear ×</button>
        )}
      </div>

      {/* Table */}
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
                    textTransform: 'uppercase', letterSpacing: '0.7px', color: D.textMuted,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(inf => (
                <tr key={inf.id} style={{ borderTop: `1px solid ${D.borderLight}` }}>
                  <td style={{ padding: '12px 16px', fontWeight: '700', color: D.accent }}>
                    @{inf.handle}
                    {inf.archived && (
                      <span style={{ marginLeft: '6px', fontSize: '10px', backgroundColor: D.surfaceHigh, color: D.textMuted, borderRadius: '4px', padding: '1px 6px', fontWeight: '700', textTransform: 'uppercase' }}>
                        Archived
                      </span>
                    )}
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
                    {inf.email
                      ? <a href={`mailto:${inf.email}`} style={{ color: D.accent, textDecoration: 'none' }}>{inf.email}</a>
                      : <span style={{ color: D.textMuted }}>—</span>
                    }
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{
                      display: 'inline-block',
                      backgroundColor: inf._count.seedings > 0 ? D.accentLight : D.surfaceHigh,
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
