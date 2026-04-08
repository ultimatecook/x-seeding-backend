import { useState } from 'react';
import { Link, useLoaderData, useRouteError, useNavigate, Form, useNavigation } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import prisma from '../db.server';
import { C, btn, card, input, section, fmtNum, fmtDate } from '../theme';

const STATUSES = ['Pending', 'Ordered', 'Shipped', 'Delivered', 'Posted'];

export async function action({ request, params }) {
  const id       = parseInt(params.id);
  const formData = await request.formData();
  const intent   = formData.get('intent');
  if (intent === 'updateNotes') {
    await prisma.influencer.update({ where: { id }, data: { notes: formData.get('notes') || null } });
  }
  if (intent === 'archive') {
    await prisma.influencer.update({ where: { id }, data: { archived: true } });
  }
  if (intent === 'unarchive') {
    await prisma.influencer.update({ where: { id }, data: { archived: false } });
  }
  return null;
}

export async function loader({ params }) {
  const id = parseInt(params.id);

  const influencer = await prisma.influencer.findUnique({
    where: { id },
    include: {
      seedings: {
        include: { products: true, campaign: { select: { id: true, title: true } } },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!influencer) throw new Response('Influencer not found', { status: 404 });
  return { influencer };
}

function adminOrderLink(s) {
  if (!s.shop) return null;
  if (s.shopifyOrderName && s.status !== 'Pending') {
    return `https://${s.shop}/admin/orders/${s.shopifyOrderName.replace('#', '')}`;
  }
  if (s.shopifyDraftOrderId) {
    return `https://${s.shop}/admin/draft_orders/${s.shopifyDraftOrderId.split('/').pop()}`;
  }
  return null;
}

function openIGPopup(handle) {
  const username = handle.replace(/^@/, '');
  const url = `https://www.instagram.com/${username}/`;
  const w = 480, h = 680;
  const left = Math.round(window.screen.width / 2 - w / 2);
  const top = Math.round(window.screen.height / 2 - h / 2);
  window.open(url, `ig_dm_${username}`, `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`);
}

export default function InfluencerDetail() {
  const { influencer } = useLoaderData();
  const navigate    = useNavigate();
  const navigation  = useNavigation();
  const isSubmitting = navigation.state === 'submitting';
  const seedings    = influencer.seedings;

  const [editNotes, setEditNotes] = useState(false);

  const totalCost  = seedings.reduce((s, sd) => s + sd.totalCost, 0);
  const totalUnits = seedings.reduce((s, sd) => s + sd.products.length, 0);
  const avgCost    = seedings.length > 0 ? totalCost / seedings.length : 0;

  const statusCounts = STATUSES.reduce((acc, s) => {
    acc[s] = seedings.filter(sd => sd.status === s).length;
    return acc;
  }, {});

  // Most seeded products
  const productMap = {};
  for (const sd of seedings) {
    for (const p of sd.products) {
      if (!productMap[p.productName]) productMap[p.productName] = 0;
      productMap[p.productName]++;
    }
  }
  const topProducts = Object.entries(productMap).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const stats = [
    { label: 'Total Seedings', value: seedings.length },
    { label: 'Total Value',    value: `€${fmtNum(totalCost)}` },
    { label: 'Units Received', value: totalUnits },
    { label: 'Avg per Seeding', value: `€${Math.round(avgCost)}` },
  ];

  return (
    <div>
      {/* Back */}
      <Link to="/app/influencers" style={{ fontSize: '13px', color: C.textSub, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px', marginBottom: '20px' }}>
        ← All Influencers
      </Link>


      {/* Profile header */}
      <div style={{ ...card.base, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ width: '52px', height: '52px', borderRadius: '50%', backgroundColor: C.accentFaint, border: `2px solid ${C.accent}`, flexShrink: 0, overflow: 'hidden', position: 'relative' }}>
            <img
              src={`https://unavatar.io/instagram/${influencer.handle.replace(/^@/, '')}`}
              alt=""
              onError={e => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex'; }}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
            <div style={{ display: 'none', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', fontSize: '20px', fontWeight: '800', color: C.accent, position: 'absolute', inset: 0 }}>
              {(influencer.handle || '@').slice(1, 2).toUpperCase()}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '20px', fontWeight: '800', color: C.text, marginBottom: '2px' }}>{influencer.handle}</div>
            <div style={{ fontSize: '14px', color: C.textSub }}>{influencer.name}</div>
            <div style={{ display: 'flex', gap: '12px', marginTop: '6px', flexWrap: 'wrap' }}>
              {influencer.country && (
                <span style={{ fontSize: '12px', color: C.textMuted }}>📍 {influencer.country}</span>
              )}
              {influencer.followers > 0 && (
                <span style={{ fontSize: '12px', color: C.textMuted }}>👥 {fmtNum(influencer.followers)} followers</span>
              )}
              {influencer.email && (
                <a href={`mailto:${influencer.email}`} style={{ fontSize: '12px', color: C.accent, textDecoration: 'none' }}>✉ {influencer.email}</a>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
          {/* Saved Sizes button */}
          <button
            onClick={() => navigate(`/app/influencer-sizes/${influencer.id}`)}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '9px 16px', borderRadius: '8px', border: `1.5px solid ${C.accent}`,
              cursor: 'pointer', fontSize: '13px', fontWeight: '700',
              backgroundColor: C.accentFaint, color: C.accent,
              transition: 'all 0.15s ease',
            }}
          >
            📏 Saved Sizes
          </button>
          {/* Message on Instagram button */}
          <button
            onClick={() => openIGPopup(influencer.handle)}
            style={{
              display: 'flex', alignItems: 'center', gap: '7px',
              padding: '9px 16px', borderRadius: '8px', border: 'none',
              cursor: 'pointer', fontSize: '13px', fontWeight: '700',
              background: 'linear-gradient(135deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)',
              color: '#fff',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="4.5" stroke="white" strokeWidth="2"/>
              <rect x="1.5" y="1.5" width="21" height="21" rx="6" stroke="white" strokeWidth="2"/>
              <circle cx="17.5" cy="6.5" r="1.2" fill="white"/>
            </svg>
            Message on Instagram
          </button>
        </div>
      </div>

      {/* Stat tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '24px' }}>
        {stats.map(({ label, value }) => (
          <div key={label} style={{ ...card.base, borderLeft: `3px solid ${C.accent}` }}>
            <div style={{ fontSize: '11px', color: C.textSub, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '8px' }}>{label}</div>
            <div style={{ fontSize: '26px', fontWeight: '900', color: C.text }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '32px' }}>
        {/* Status breakdown */}
        <div style={{ ...card.base }}>
          <div style={{ ...section.title, marginBottom: '14px' }}>Status Breakdown</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {STATUSES.filter(s => statusCounts[s] > 0).map(s => (
              <div key={s} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ padding: '3px 10px', ...C.status[s], borderRadius: '12px', fontSize: '12px', fontWeight: '700' }}>{s}</span>
                <span style={{ fontSize: '13px', fontWeight: '700', color: C.text }}>{statusCounts[s]}</span>
              </div>
            ))}
            {Object.values(statusCounts).every(v => v === 0) && (
              <span style={{ fontSize: '13px', color: C.textMuted }}>No seedings yet</span>
            )}
          </div>
        </div>

        {/* Top products */}
        <div style={{ ...card.base }}>
          <div style={{ ...section.title, marginBottom: '14px' }}>Most Seeded Products</div>
          {topProducts.length === 0 ? (
            <span style={{ fontSize: '13px', color: C.textMuted }}>No products yet</span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {topProducts.map(([name, count]) => (
                <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '13px', color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                  <span style={{ fontSize: '12px', fontWeight: '700', color: C.accent, flexShrink: 0 }}>{count}×</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Notes + Archive */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px', marginBottom: '24px' }}>
        {/* Notes card */}
        <div style={{ ...card.base }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <div style={{ ...section.title }}>📝 Notes</div>
            {!editNotes && (
              <button type="button" onClick={() => setEditNotes(true)}
                style={{ ...btn.ghost, fontSize: '11px', padding: '3px 10px' }}>
                {influencer.notes ? 'Edit' : '+ Add'}
              </button>
            )}
          </div>
          {editNotes ? (
            <Form method="post" onSubmit={() => setEditNotes(false)}>
              <input type="hidden" name="intent" value="updateNotes" />
              <textarea name="notes" defaultValue={influencer.notes || ''} rows={4}
                placeholder="e.g. prefers DM, waiting on address, loves unboxing content…"
                onKeyDown={e => { if (e.key === 'Escape') setEditNotes(false); }}
                style={{ ...input.base, width: '100%', resize: 'vertical', fontSize: '13px', boxSizing: 'border-box', display: 'block', marginBottom: '8px' }}
              />
              <div style={{ display: 'flex', gap: '6px' }}>
                <button type="submit" disabled={isSubmitting} style={{ ...btn.primary, fontSize: '12px', padding: '6px 14px' }}>Save</button>
                <button type="button" onClick={() => setEditNotes(false)} style={{ ...btn.ghost, fontSize: '12px', padding: '6px 10px' }}>Cancel</button>
              </div>
            </Form>
          ) : (
            <p style={{ margin: 0, fontSize: '13px', color: influencer.notes ? C.text : C.textMuted, fontStyle: influencer.notes ? 'normal' : 'italic', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
              {influencer.notes || 'No notes yet. Click + Add to write something.'}
            </p>
          )}
        </div>

        {/* Archive card */}
        <div style={{ ...card.base }}>
          <div style={{ ...section.title, marginBottom: '10px' }}>⚙️ Status</div>
          <p style={{ fontSize: '13px', color: C.textSub, margin: '0 0 14px', lineHeight: '1.5' }}>
            {influencer.archived
              ? 'This influencer is archived and hidden from the active list.'
              : 'Archive to hide from active lists without deleting.'}
          </p>
          <Form method="post">
            <input type="hidden" name="intent" value={influencer.archived ? 'unarchive' : 'archive'} />
            <button type="submit" disabled={isSubmitting}
              style={{ ...btn.secondary, fontSize: '12px', padding: '7px 14px', width: '100%',
                ...(influencer.archived ? {} : { color: '#92400E', borderColor: '#FCD34D', backgroundColor: '#FFFBEB' }) }}>
              {influencer.archived ? '↩ Unarchive' : '📦 Archive influencer'}
            </button>
          </Form>
        </div>
      </div>

      {/* Seedings history */}
      <div>
        <div style={{ ...section.title, marginBottom: '16px' }}>Seeding History</div>
        {seedings.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', border: `2px dashed ${C.border}`, borderRadius: '8px', color: C.textMuted, fontSize: '13px' }}>
            No seedings for this influencer yet.
          </div>
        ) : (
          <div style={{ ...card.flat, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  {['Date', 'Campaign', 'Products', 'Cost', 'Status', 'Order'].map(h => (
                    <th key={h} style={{ padding: '12px', textAlign: 'left', fontWeight: '700', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.7px', color: C.textSub }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {seedings.map(s => {
                  const link = adminOrderLink(s);
                  return (
                    <tr key={s.id} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                      <td style={{ padding: '12px', color: C.textMuted, whiteSpace: 'nowrap' }}>
                        {fmtDate(s.createdAt)}
                      </td>
                      <td style={{ padding: '12px' }}>
                        {s.campaign
                          ? <Link to={`/app/campaigns/${s.campaign.id}`} style={{ color: C.accent, fontWeight: '600', textDecoration: 'none', fontSize: '12px' }}>{s.campaign.title}</Link>
                          : <span style={{ color: C.textMuted }}>—</span>
                        }
                      </td>
                      <td style={{ padding: '12px', color: C.textSub, maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.products.map(p => p.productName).join(', ')}
                      </td>
                      <td style={{ padding: '12px', fontWeight: '700', color: C.text, whiteSpace: 'nowrap' }}>
                        €{s.totalCost.toFixed(2)}
                      </td>
                      <td style={{ padding: '12px' }}>
                        <span style={{ padding: '3px 10px', ...C.status[s.status], borderRadius: '12px', fontSize: '11px', fontWeight: '700' }}>
                          {s.status}
                        </span>
                      </td>
                      <td style={{ padding: '12px' }}>
                        {link
                          ? <a href={link} target="_top" rel="noopener noreferrer" style={{ fontSize: '11px', fontWeight: '700', padding: '4px 10px', border: `1px solid ${C.border}`, borderRadius: '5px', color: C.textSub, textDecoration: 'none', backgroundColor: C.surfaceHigh, whiteSpace: 'nowrap' }}>
                              {s.status === 'Pending' ? 'Draft ↗' : 'Order ↗'}
                            </a>
                          : <span style={{ color: C.textMuted }}>—</span>
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
