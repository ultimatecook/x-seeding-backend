import { useState } from 'react';
import { Link, useLoaderData, Form, useNavigation, redirect } from 'react-router';
import prisma from '../db.server';
import { requirePortalUser } from '../utils/portal-auth.server';
import { can, requirePermission } from '../utils/portal-permissions';
import { audit } from '../utils/audit.server.js';
import { fmtNum, fmtDate } from '../theme';
import { D, InstagramAvatar } from '../utils/portal-theme';

// ─── Design tokens (portal purple palette) ───────────────────────────────────

const STATUS_COLORS = {
  Pending:   { bg: D.statusPending.bg,   color: D.statusPending.color   },
  Ordered:   { bg: D.statusOrdered.bg,   color: D.statusOrdered.color   },
  Shipped:   { bg: D.statusShipped.bg,   color: D.statusShipped.color   },
  Delivered: { bg: D.statusDelivered.bg, color: D.statusDelivered.color },
  Posted:    { bg: D.statusPosted.bg,    color: D.statusPosted.color    },
};


const STATUSES = ['Pending', 'Ordered', 'Shipped', 'Delivered', 'Posted'];

// ─── Action ──────────────────────────────────────────────────────────────────
export async function action({ request, params }) {
  const { shop, portalUser } = await requirePortalUser(request);
  const id       = parseInt(params.id);
  const formData = await request.formData();
  const intent   = formData.get('intent');

  if (intent === 'updateProfile') {
    requirePermission(portalUser.role, 'editInfluencer');
    const handle  = formData.get('handle')  ? String(formData.get('handle')).slice(0, 100).trim()  : undefined;
    const name    = formData.get('name')    ? String(formData.get('name')).slice(0, 200).trim()    : undefined;
    const country = formData.get('country') ? String(formData.get('country')).slice(0, 100).trim() : undefined;
    const email   = formData.get('email')   ? String(formData.get('email')).slice(0, 254).trim().toLowerCase() : null;
    const followers = Math.max(0, parseInt(formData.get('followers') || '0') || 0);
    await prisma.influencer.update({ where: { id }, data: { handle, name, country, email, followers } });
    await audit({ shop, portalUser, action: 'updated_influencer', entityType: 'influencer', entityId: id, detail: `Updated profile for ${handle}` });
  }

  if (intent === 'updateNotes') {
    requirePermission(portalUser.role, 'editInfluencer');
    const notes = formData.get('notes') ? String(formData.get('notes')).slice(0, 1000) : null;
    await prisma.influencer.update({ where: { id }, data: { notes } });
    await audit({ shop, portalUser, action: 'updated_influencer_notes', entityType: 'influencer', entityId: id, detail: 'Updated notes' });
  }

  if (intent === 'updateSizes') {
    requirePermission(portalUser.role, 'editInfluencer');
    const categories = ['tops', 'bottoms', 'footwear'];
    for (const category of categories) {
      const size = formData.get(`size_${category}`)?.trim() || null;
      if (size) {
        await prisma.influencerSavedSize.upsert({
          where:  { influencerId_category: { influencerId: id, category } },
          update: { size },
          create: { influencerId: id, category, size },
        });
      } else {
        await prisma.influencerSavedSize.deleteMany({ where: { influencerId: id, category } });
      }
    }
    await audit({ shop, portalUser, action: 'updated_influencer_sizes', entityType: 'influencer', entityId: id, detail: 'Updated saved sizes' });
  }

  if (intent === 'archive') {
    requirePermission(portalUser.role, 'editInfluencer');
    await prisma.influencer.update({ where: { id }, data: { archived: true } });
    await audit({ shop, portalUser, action: 'archived_influencer', entityType: 'influencer', entityId: id, detail: 'Archived influencer' });
  }

  if (intent === 'unarchive') {
    requirePermission(portalUser.role, 'editInfluencer');
    await prisma.influencer.update({ where: { id }, data: { archived: false } });
    await audit({ shop, portalUser, action: 'unarchived_influencer', entityType: 'influencer', entityId: id, detail: 'Unarchived influencer' });
  }

  if (intent === 'delete') {
    requirePermission(portalUser.role, 'deleteInfluencer');
    const inf = await prisma.influencer.findUnique({ where: { id }, select: { handle: true } });
    // Delete all related seeding products, then seedings, then the influencer
    const seedingIds = (await prisma.seeding.findMany({ where: { influencerId: id }, select: { id: true } })).map(s => s.id);
    if (seedingIds.length > 0) {
      await prisma.seedingProduct.deleteMany({ where: { seedingId: { in: seedingIds } } });
      await prisma.seeding.deleteMany({ where: { id: { in: seedingIds } } });
    }
    await prisma.influencerSavedSize.deleteMany({ where: { influencerId: id } }).catch(() => {});
    await prisma.influencer.delete({ where: { id } });
    await audit({ shop, portalUser, action: 'deleted_influencer', entityType: 'influencer', entityId: id, detail: `Deleted influencer @${inf?.handle}` });
    throw redirect('/portal/influencers');
  }

  return null;
}

// ─── Loader ──────────────────────────────────────────────────────────────────
export async function loader({ request, params }) {
  const { portalUser } = await requirePortalUser(request);
  requirePermission(portalUser.role, 'viewInfluencers');
  const id = parseInt(params.id);

  const influencer = await prisma.influencer.findUnique({
    where: { id },
    include: {
      seedings: {
        include: {
          products: true,
          campaign: { select: { id: true, title: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!influencer) throw new Response('Influencer not found', { status: 404 });

  const savedSizes = await prisma.influencerSavedSize.findMany({
    where:   { influencerId: id },
    orderBy: { category: 'asc' },
  });

  const role    = portalUser.role;
  const canEdit = can.editInfluencer(role);
  return { influencer, canEdit, savedSizes };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const COUNTRIES = [
  'Argentina','Australia','Austria','Belgium','Brazil','Canada','Chile','China',
  'Colombia','Czech Republic','Denmark','Finland','France','Germany','Greece',
  'Hong Kong','Hungary','India','Indonesia','Ireland','Israel','Italy','Japan',
  'Malaysia','Mexico','Netherlands','New Zealand','Nigeria','Norway','Peru',
  'Philippines','Poland','Portugal','Romania','Russia','Saudi Arabia','Singapore',
  'South Africa','South Korea','Spain','Sweden','Switzerland','Taiwan','Thailand',
  'Turkey','UAE','Ukraine','United Kingdom','United States','Vietnam','Other',
];

const card = (extra = {}) => ({
  background: D.surface,
  border:     `1px solid ${D.border}`,
  borderRadius: D.radius,
  padding:    '20px 24px',
  boxShadow:  D.shadow,
  ...extra,
});

// ─── Component ───────────────────────────────────────────────────────────────
export default function PortalInfluencerDetail() {
  const { influencer, canEdit, savedSizes } = useLoaderData();
  const navigation   = useNavigation();
  const isSubmitting = navigation.state === 'submitting';
  const seedings     = influencer.seedings;

  const [editProfile,    setEditProfile]    = useState(false);
  const [editNotes,      setEditNotes]      = useState(false);
  const [confirmDelete,  setConfirmDelete]  = useState(false);

  // KPIs
  const totalCost  = seedings.reduce((s, sd) => s + (sd.totalCost ?? 0), 0);
  const totalUnits = seedings.reduce((s, sd) => s + (sd.products?.length ?? 0), 0);
  const avgCost    = seedings.length > 0 ? totalCost / seedings.length : 0;

  const statusCounts = STATUSES.reduce((acc, s) => {
    acc[s] = seedings.filter(sd => sd.status === s).length;
    return acc;
  }, {});

  // Top products
  const productMap = {};
  for (const sd of seedings) {
    for (const p of sd.products || []) {
      if (!productMap[p.productName]) productMap[p.productName] = 0;
      productMap[p.productName]++;
    }
  }
  const topProducts = Object.entries(productMap).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const handle = influencer.handle?.replace(/^@/, '') || '';
  const initials = handle.slice(0, 2).toUpperCase() || '?';

  const kpis = [
    { label: 'Total Seedings', value: seedings.length },
    { label: 'Total Value',    value: `€${fmtNum(totalCost)}` },
    { label: 'Units Sent',     value: totalUnits },
    { label: 'Avg per Send',   value: `€${Math.round(avgCost)}` },
  ];

  return (
    <div style={{ padding: '24px 32px', maxWidth: '1100px', margin: '0 auto' }}>

      {/* Back */}
      <Link to="/portal/influencers"
        style={{ fontSize: '13px', color: D.textSub, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '5px', marginBottom: '20px', fontWeight: '500' }}>
        ← All Influencers
      </Link>

      {/* Profile header */}
      <div style={{ ...card(), display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', flexWrap: 'wrap', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <InstagramAvatar handle={handle} size={56} />
          {/* Info */}
          <div>
            <div style={{ fontSize: '20px', fontWeight: '900', color: D.text, marginBottom: '2px' }}>@{handle}</div>
            {influencer.name && <div style={{ fontSize: '14px', color: D.textSub, marginBottom: '6px' }}>{influencer.name}</div>}
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              {influencer.country && <span style={{ fontSize: '12px', color: D.textMuted }}>📍 {influencer.country}</span>}
              {influencer.followers > 0 && <span style={{ fontSize: '12px', color: D.textMuted }}>👥 {fmtNum(influencer.followers)}</span>}
              {influencer.email && (
                <a href={`mailto:${influencer.email}`} style={{ fontSize: '12px', color: D.accent, textDecoration: 'none' }}>✉ {influencer.email}</a>
              )}
              {influencer.archived && (
                <span style={{ fontSize: '11px', fontWeight: '700', padding: '2px 8px', borderRadius: '6px', backgroundColor: D.errorBg, color: D.errorText }}>Archived</span>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        {canEdit && (
          <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
            <button type="button" onClick={() => setEditProfile(v => !v)}
              style={{ padding: '9px 16px', borderRadius: '8px', border: `1.5px solid ${editProfile ? D.accent : D.border}`, cursor: 'pointer', fontSize: '13px', fontWeight: '700', backgroundColor: editProfile ? D.accentLight : 'transparent', color: editProfile ? D.accent : D.textSub }}>
              ✏️ Edit Profile
            </button>
            <a href={`https://www.instagram.com/${handle}/`} target="_blank" rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '9px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: '700', textDecoration: 'none', background: 'linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)', color: '#fff' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4.5" stroke="white" strokeWidth="2"/><rect x="1.5" y="1.5" width="21" height="21" rx="6" stroke="white" strokeWidth="2"/><circle cx="17.5" cy="6.5" r="1.2" fill="white"/></svg>
              Instagram
            </a>
          </div>
        )}
      </div>

      {/* Edit profile panel */}
      {editProfile && canEdit && (
        <Form method="post" onSubmit={() => setEditProfile(false)}
          style={{ ...card({ marginBottom: '16px' }), display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <input type="hidden" name="intent" value="updateProfile" />
          <div style={{ gridColumn: '1 / -1', fontSize: '13px', fontWeight: '700', color: D.text }}>Edit Profile</div>
          {[
            { name: 'handle',    label: 'Instagram Handle', defaultValue: influencer.handle,          type: 'text'   },
            { name: 'name',      label: 'Full Name',        defaultValue: influencer.name || '',      type: 'text'   },
            { name: 'followers', label: 'Followers',        defaultValue: influencer.followers || '', type: 'number' },
            { name: 'country',   label: 'Country',          defaultValue: influencer.country || '',   type: 'select' },
            { name: 'email',     label: 'Email',            defaultValue: influencer.email || '',     type: 'email'  },
          ].map(f => (
            <label key={f.name} style={{ fontSize: '12px', fontWeight: '600', color: D.textSub, display: 'flex', flexDirection: 'column', gap: '5px' }}>
              {f.label}
              {f.type === 'select' ? (
                <select name={f.name} defaultValue={f.defaultValue}
                  style={{ padding: '8px 10px', borderRadius: '7px', border: `1px solid ${D.border}`, fontSize: '13px', color: D.text, background: D.surface }}>
                  <option value="">— Select —</option>
                  {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              ) : (
                <input name={f.name} type={f.type} defaultValue={f.defaultValue}
                  style={{ padding: '8px 10px', borderRadius: '7px', border: `1px solid ${D.border}`, fontSize: '13px', color: D.text, background: D.surface }} />
              )}
            </label>
          ))}
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '8px' }}>
            <button type="submit" disabled={isSubmitting}
              style={{ padding: '9px 20px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: '700', background: `linear-gradient(135deg,${D.accent},${D.accentHover})`, color: '#fff' }}>
              {isSubmitting ? 'Saving…' : 'Save Changes'}
            </button>
            <button type="button" onClick={() => setEditProfile(false)}
              style={{ padding: '9px 14px', borderRadius: '8px', border: `1px solid ${D.border}`, cursor: 'pointer', fontSize: '13px', fontWeight: '600', backgroundColor: 'transparent', color: D.textSub }}>
              Cancel
            </button>
          </div>
        </Form>
      )}

      {/* KPI tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
        {kpis.map(({ label, value }) => (
          <div key={label} style={{ ...card({ borderLeft: `3px solid ${D.accent}`, padding: '16px 20px' }) }}>
            <div style={{ fontSize: '10px', fontWeight: '700', color: D.textMuted, textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: '8px' }}>{label}</div>
            <div style={{ fontSize: '24px', fontWeight: '900', color: D.text }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Two columns: status breakdown + top products */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>

        {/* Status breakdown */}
        <div style={card()}>
          <div style={{ fontSize: '12px', fontWeight: '800', color: D.text, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '14px' }}>Status Breakdown</div>
          {STATUSES.filter(s => statusCounts[s] > 0).length === 0 ? (
            <span style={{ fontSize: '13px', color: D.textMuted }}>No seedings yet</span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {STATUSES.filter(s => statusCounts[s] > 0).map(s => {
                const sc = STATUS_COLORS[s] || { bg: D.surfaceHigh, color: D.textSub };
                return (
                  <div key={s} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ padding: '3px 10px', backgroundColor: sc.bg, color: sc.color, borderRadius: '12px', fontSize: '12px', fontWeight: '700' }}>{s}</span>
                    <span style={{ fontSize: '13px', fontWeight: '700', color: D.text }}>{statusCounts[s]}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Top products */}
        <div style={card()}>
          <div style={{ fontSize: '12px', fontWeight: '800', color: D.text, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '14px' }}>Most Seeded Products</div>
          {topProducts.length === 0 ? (
            <span style={{ fontSize: '13px', color: D.textMuted }}>No products yet</span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {topProducts.map(([name, count]) => (
                <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '13px', color: D.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                  <span style={{ fontSize: '12px', fontWeight: '700', color: D.accent, flexShrink: 0 }}>{count}×</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Notes + Archive */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px', marginBottom: '24px' }}>

        {/* Notes */}
        <div style={card()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <div style={{ fontSize: '12px', fontWeight: '800', color: D.text, textTransform: 'uppercase', letterSpacing: '0.6px' }}>📝 Notes</div>
            {canEdit && !editNotes && (
              <button type="button" onClick={() => setEditNotes(true)}
                style={{ padding: '4px 10px', borderRadius: '6px', border: `1px solid ${D.border}`, cursor: 'pointer', fontSize: '11px', fontWeight: '600', backgroundColor: 'transparent', color: D.textSub }}>
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
                style={{ width: '100%', padding: '8px 10px', borderRadius: '7px', border: `1px solid ${D.border}`, fontSize: '13px', color: D.text, background: D.surface, resize: 'vertical', boxSizing: 'border-box', display: 'block', marginBottom: '8px' }}
              />
              <div style={{ display: 'flex', gap: '6px' }}>
                <button type="submit" disabled={isSubmitting}
                  style={{ padding: '7px 16px', borderRadius: '7px', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: '700', background: `linear-gradient(135deg,${D.accent},${D.accentHover})`, color: '#fff' }}>
                  {isSubmitting ? 'Saving…' : 'Save'}
                </button>
                <button type="button" onClick={() => setEditNotes(false)}
                  style={{ padding: '7px 12px', borderRadius: '7px', border: `1px solid ${D.border}`, cursor: 'pointer', fontSize: '12px', fontWeight: '600', backgroundColor: 'transparent', color: D.textSub }}>
                  Cancel
                </button>
              </div>
            </Form>
          ) : (
            <p style={{ margin: 0, fontSize: '13px', color: influencer.notes ? D.text : D.textMuted, fontStyle: influencer.notes ? 'normal' : 'italic', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
              {influencer.notes || 'No notes yet.'}
            </p>
          )}
        </div>

        {/* Archive + Delete */}
        {canEdit && (
          <div style={card()}>
            <div style={{ fontSize: '12px', fontWeight: '800', color: D.text, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '10px' }}>⚙️ Status</div>
            <p style={{ fontSize: '13px', color: D.textSub, margin: '0 0 14px', lineHeight: '1.5' }}>
              {influencer.archived
                ? 'This influencer is archived and hidden from the active list.'
                : 'Archive to hide from active lists without deleting.'}
            </p>
            <Form method="post" style={{ marginBottom: '8px' }}>
              <input type="hidden" name="intent" value={influencer.archived ? 'unarchive' : 'archive'} />
              <button type="submit" disabled={isSubmitting}
                style={{ width: '100%', padding: '9px 16px', borderRadius: '8px', border: `1px solid ${influencer.archived ? D.accent : D.warningText}`, cursor: 'pointer', fontSize: '13px', fontWeight: '700', backgroundColor: influencer.archived ? D.accentLight : D.warningBg, color: influencer.archived ? D.accent : D.warningText }}>
                {influencer.archived ? '↩ Unarchive' : '📦 Archive'}
              </button>
            </Form>

            {/* Delete — requires confirmation */}
            {!confirmDelete ? (
              <button type="button" onClick={() => setConfirmDelete(true)}
                style={{ width: '100%', padding: '9px 16px', borderRadius: '8px', border: `1px solid ${D.errorText}`, cursor: 'pointer', fontSize: '13px', fontWeight: '700', backgroundColor: 'transparent', color: D.errorText }}>
                🗑 Delete Influencer
              </button>
            ) : (
              <div style={{ padding: '12px', borderRadius: '8px', border: `1px solid ${D.errorText}`, backgroundColor: D.errorBg }}>
                <p style={{ margin: '0 0 10px', fontSize: '13px', color: D.errorText, fontWeight: '600' }}>
                  This will permanently delete @{handle} and all their seedings. Are you sure?
                </p>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <Form method="post" style={{ flex: 1 }}>
                    <input type="hidden" name="intent" value="delete" />
                    <button type="submit" disabled={isSubmitting}
                      style={{ width: '100%', padding: '8px', borderRadius: '7px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: '700', backgroundColor: D.errorText, color: '#fff' }}>
                      {isSubmitting ? 'Deleting…' : 'Yes, Delete'}
                    </button>
                  </Form>
                  <button type="button" onClick={() => setConfirmDelete(false)}
                    style={{ padding: '8px 14px', borderRadius: '7px', border: `1px solid ${D.border}`, cursor: 'pointer', fontSize: '13px', fontWeight: '600', backgroundColor: 'transparent', color: D.textSub }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Saved Sizes */}
      {canEdit && (
        <div style={{ ...card(), marginBottom: '24px' }}>
          <div style={{ fontSize: '12px', fontWeight: '800', color: D.text, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '14px' }}>
            👗 Saved Sizes
          </div>
          <Form method="post">
            <input type="hidden" name="intent" value="updateSizes" />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '12px' }}>
              {[
                { category: 'tops',     label: 'Tops',     sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] },
                { category: 'bottoms',  label: 'Bottoms',  sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] },
                { category: 'footwear', label: 'Footwear', sizes: ['35','36','37','38','39','40','41','42','43','44','45','5','5.5','6','6.5','7','7.5','8','8.5','9','9.5','10','10.5','11'] },
              ].map(({ category, label, sizes }) => {
                const saved = savedSizes.find(s => s.category === category)?.size ?? '';
                return (
                  <label key={category} style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '12px', fontWeight: '600', color: D.textSub }}>
                    {label}
                    <select
                      name={`size_${category}`}
                      defaultValue={saved}
                      style={{ padding: '7px 10px', borderRadius: '7px', border: `1px solid ${D.border}`, fontSize: '13px', color: D.text, background: D.surface }}
                    >
                      <option value="">— Not set —</option>
                      {sizes.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                );
              })}
            </div>
            <button type="submit" disabled={isSubmitting}
              style={{ padding: '8px 18px', borderRadius: '7px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: '700', background: `linear-gradient(135deg,${D.accent},${D.accentHover})`, color: '#fff' }}>
              {isSubmitting ? 'Saving…' : 'Save Sizes'}
            </button>
          </Form>
        </div>
      )}

      {/* Seeding history */}
      <div>
        <div style={{ fontSize: '12px', fontWeight: '800', color: D.text, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '16px' }}>Seeding History</div>
        {seedings.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', border: `2px dashed ${D.border}`, borderRadius: D.radius, color: D.textMuted, fontSize: '13px' }}>
            No seedings for this influencer yet.
          </div>
        ) : (
          <div style={{ background: D.surface, border: `1px solid ${D.border}`, borderRadius: D.radius, overflow: 'hidden', boxShadow: D.shadow }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${D.border}`, backgroundColor: D.surfaceHigh }}>
                  {['Date', 'Campaign', 'Products', 'Value', 'Status'].map(h => (
                    <th key={h} style={{ padding: '11px 16px', textAlign: 'left', fontWeight: '700', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.7px', color: D.textSub }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {seedings.map((s, i) => (
                  <tr key={s.id} style={{ borderBottom: i < seedings.length - 1 ? `1px solid ${D.borderLight}` : 'none' }}>
                    <td style={{ padding: '12px 16px', color: D.textMuted, whiteSpace: 'nowrap', fontSize: '12px' }}>
                      {fmtDate(s.createdAt)}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {s.campaign
                        ? <Link to={`/portal/campaigns/${s.campaign.id}`} style={{ color: D.accent, fontWeight: '600', textDecoration: 'none', fontSize: '12px' }}>{s.campaign.title}</Link>
                        : <span style={{ color: D.textMuted }}>—</span>}
                    </td>
                    <td style={{ padding: '12px 16px', color: D.textSub, maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '12px' }}>
                      {s.products.map(p => p.productName).join(', ')}
                    </td>
                    <td style={{ padding: '12px 16px', fontWeight: '700', color: D.text, whiteSpace: 'nowrap' }}>
                      €{(s.totalCost ?? 0).toFixed(2)}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {(() => {
                        const sc = STATUS_COLORS[s.status] || { bg: D.surfaceHigh, color: D.textSub };
                        return <span style={{ padding: '3px 10px', backgroundColor: sc.bg, color: sc.color, borderRadius: '12px', fontSize: '11px', fontWeight: '700' }}>{s.status}</span>;
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
