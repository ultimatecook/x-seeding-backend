import { useState } from 'react';
import { useLoaderData, Form, useSearchParams, Link } from 'react-router';
import prisma from '../db.server';
import { requirePortalUser } from '../utils/portal-auth.server';
import { C, btn, card, fmtNum } from '../theme';

export async function loader({ request }) {
  await requirePortalUser(request);
  const influencers = await prisma.influencer.findMany({
    where:   { archived: false },
    orderBy: { name: 'asc' },
  });
  return { influencers };
}

export default function PortalInfluencers() {
  const { influencers } = useLoaderData();
  const [q, setQ] = useState('');

  const filtered = influencers.filter(inf =>
    !q || inf.name?.toLowerCase().includes(q.toLowerCase()) || inf.handle?.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2 style={{ margin: 0, color: C.text }}>
          Influencers <span style={{ fontSize: '14px', fontWeight: '400', color: C.textMuted }}>({influencers.length})</span>
        </h2>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <input
          type="text"
          placeholder="Search by name or handle…"
          value={q}
          onChange={e => setQ(e.target.value)}
          style={{ padding: '8px 12px', border: `1px solid ${C.border}`, borderRadius: '6px', fontSize: '13px', width: '260px', backgroundColor: C.surface, color: C.text }}
        />
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: C.textMuted, border: `2px dashed ${C.border}`, borderRadius: '8px' }}>
          <p style={{ margin: 0 }}>No influencers found.</p>
        </div>
      ) : (
        <div style={{ ...card.flat, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {['Handle', 'Name', 'Followers', 'Country', 'Email'].map(h => (
                  <th key={h} style={{ padding: '12px', textAlign: 'left', fontWeight: '700', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.7px', color: C.textSub }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(inf => (
                <tr key={inf.id} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                  <td style={{ padding: '12px', fontWeight: '700', color: C.text }}>@{inf.handle}</td>
                  <td style={{ padding: '12px', color: C.textSub }}>{inf.name}</td>
                  <td style={{ padding: '12px', color: C.textSub }}>{fmtNum(inf.followers)}</td>
                  <td style={{ padding: '12px', color: C.textSub }}>{inf.country}</td>
                  <td style={{ padding: '12px', color: C.textSub }}>{inf.email || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
