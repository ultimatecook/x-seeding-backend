import { useState } from 'react';
import { Link, useLoaderData, Form, useNavigation, redirect } from 'react-router';
import prisma from '../db.server';
import { requirePortalUser } from '../utils/portal-auth.server';
import { can, requirePermission } from '../utils/portal-permissions';
import { audit } from '../utils/audit.server.js';
import { fmtNum, fmtDate } from '../theme';
import { D, InstagramAvatar } from '../utils/portal-theme';
import { useT } from '../utils/i18n';
import { releaseDiscountCodes } from '../utils/discount-codes.server';

// ── Action ────────────────────────────────────────────────────────────────────
export async function action({ request, params }) {
  const { shop, portalUser } = await requirePortalUser(request);
  const id       = parseInt(params.id);
  const formData = await request.formData();
  const intent   = formData.get('intent');

  if (intent === 'updateProfile') {
    requirePermission(portalUser.role, 'editInfluencer');
    const handle    = formData.get('handle')    ? String(formData.get('handle')).slice(0, 100).trim()    : undefined;
    const name      = formData.get('name')      ? String(formData.get('name')).slice(0, 200).trim()      : undefined;
    const country   = formData.get('country')   ? String(formData.get('country')).slice(0, 100).trim()   : undefined;
    const city      = formData.get('city')      ? String(formData.get('city')).slice(0, 100).trim()      : null;
    const gender    = formData.get('gender')    ? String(formData.get('gender')).slice(0, 50).trim()     : null;
    const email     = formData.get('email')     ? String(formData.get('email')).slice(0, 254).trim().toLowerCase() : null;
    const phone     = formData.get('phone')     ? String(formData.get('phone')).slice(0, 50).trim()      : null;
    const followers = Math.max(0, parseInt(formData.get('followers') || '0') || 0);
    await prisma.influencer.update({ where: { id }, data: { handle, name, country, city, gender, email, phone, followers } });
    await audit({ shop, portalUser, action: 'updated_influencer', entityType: 'influencer', entityId: id, detail: `Updated profile for ${handle}` });
  }

  if (intent === 'updateShipping') {
    requirePermission(portalUser.role, 'editInfluencer');
    const defaultShippingAddress = formData.get('defaultShippingAddress') ? String(formData.get('defaultShippingAddress')).slice(0, 500).trim() : null;
    const shippingNotes          = formData.get('shippingNotes')          ? String(formData.get('shippingNotes')).slice(0, 500).trim()          : null;
    await prisma.influencer.update({ where: { id }, data: { defaultShippingAddress, shippingNotes } });
    await audit({ shop, portalUser, action: 'updated_influencer_shipping', entityType: 'influencer', entityId: id, detail: 'Updated shipping info' });
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
    const inf = await prisma.influencer.findUnique({ where: { id }, select: { handle: true, shop: true } });
    if (!inf || inf.shop !== shop) return null;
    const seedingIds = (await prisma.seeding.findMany({ where: { shop, influencerId: id }, select: { id: true } })).map(s => s.id);
    if (seedingIds.length > 0) {
      await Promise.all(seedingIds.map(sid => releaseDiscountCodes(shop, sid)));
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

// ── Loader ────────────────────────────────────────────────────────────────────
export async function loader({ request, params }) {
  const { shop, portalUser } = await requirePortalUser(request);
  requirePermission(portalUser.role, 'viewInfluencers');
  const id = parseInt(params.id);

  const influencer = await prisma.influencer.findUnique({
    where: { id },
    include: {
      seedings: {
        where:   { shop },
        include: { products: true, campaign: { select: { id: true, title: true } } },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!influencer || influencer.shop !== shop) throw new Response('Influencer not found', { status: 404 });

  const savedSizes = await prisma.influencerSavedSize.findMany({
    where: { influencerId: id }, orderBy: { category: 'asc' },
  });

  const role    = portalUser.role;
  const canEdit = can.editInfluencer(role);
  return { influencer, canEdit, savedSizes };
}

// ── Constants ─────────────────────────────────────────────────────────────────
const COUNTRIES = [
  'Argentina','Australia','Austria','Belgium','Brazil','Canada','Chile','China',
  'Colombia','Czech Republic','Denmark','Finland','France','Germany','Greece',
  'Hong Kong','Hungary','India','Indonesia','Ireland','Israel','Italy','Japan',
  'Malaysia','Mexico','Netherlands','New Zealand','Nigeria','Norway','Peru',
  'Philippines','Poland','Portugal','Romania','Russia','Saudi Arabia','Singapore',
  'South Africa','South Korea','Spain','Sweden','Switzerland','Taiwan','Thailand',
  'Turkey','UAE','Ukraine','United Kingdom','United States','Vietnam','Other',
];

const STATUSES = ['Pending', 'Ordered', 'Shipped', 'Delivered', 'Posted'];

const STATUS_COLORS = {
  Pending:   { bg: D.statusPending.bg,   color: D.statusPending.color,   dot: D.statusPending.dot   },
  Ordered:   { bg: D.statusOrdered.bg,   color: D.statusOrdered.color,   dot: D.statusOrdered.dot   },
  Shipped:   { bg: D.statusShipped.bg,   color: D.statusShipped.color,   dot: D.statusShipped.dot   },
  Delivered: { bg: D.statusDelivered.bg, color: D.statusDelivered.color, dot: D.statusDelivered.dot },
  Posted:    { bg: D.statusPosted.bg,    color: D.statusPosted.color,    dot: D.statusPosted.dot    },
};

// ── Shared components ─────────────────────────────────────────────────────────
function Card({ children, style = {} }) {
  return (
    <div style={{
      backgroundColor: 'var(--pt-surface)',
      border: '1px solid var(--pt-border)',
      borderRadius: '14px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      overflow: 'hidden',
      ...style,
    }}>
      {children}
    </div>
  );
}

function CardHeader({ title, right }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '13px 20px', borderBottom: '1px solid var(--pt-border)',
    }}>
      <span style={{ fontSize: '10px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.9px', color: 'var(--pt-text-muted)' }}>
        {title}
      </span>
      {right}
    </div>
  );
}

function StatusPill({ status }) {
  const m = STATUS_COLORS[status] || { bg: D.surfaceHigh, color: D.textSub, dot: D.textMuted };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      backgroundColor: m.bg, color: m.color,
      borderRadius: '20px', padding: '3px 9px',
      fontSize: '11px', fontWeight: '700', whiteSpace: 'nowrap',
    }}>
      <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: m.dot, flexShrink: 0 }} />
      {status}
    </span>
  );
}

function EditBtn({ onClick, active, label }) {
  return (
    <button type="button" onClick={onClick} style={{
      padding: '4px 10px', borderRadius: '6px', cursor: 'pointer',
      fontSize: '11px', fontWeight: '600',
      border: `1px solid ${active ? 'var(--pt-accent)' : 'var(--pt-border)'}`,
      backgroundColor: active ? 'var(--pt-accent-light)' : 'transparent',
      color: active ? 'var(--pt-accent)' : 'var(--pt-text-sub)',
    }}>
      {label}
    </button>
  );
}

function TagPills({ value }) {
  if (!value) return <span style={{ fontSize: '13px', color: 'var(--pt-text-muted)', fontStyle: 'italic' }}>—</span>;
  const tags = value.split(',').map(t => t.trim()).filter(Boolean);
  if (!tags.length) return <span style={{ fontSize: '13px', color: 'var(--pt-text-muted)', fontStyle: 'italic' }}>—</span>;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
      {tags.map((tag, i) => (
        <span key={i} style={{
          fontSize: '11px', fontWeight: '600', padding: '3px 8px', borderRadius: '20px',
          backgroundColor: 'var(--pt-surface-high)', border: '1px solid var(--pt-border)',
          color: 'var(--pt-text-sub)',
        }}>{tag}</span>
      ))}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function PortalInfluencerDetail() {
  const { influencer, canEdit, savedSizes } = useLoaderData();
  const navigation   = useNavigation();
  const { t }        = useT();
  const isSubmitting = navigation.state === 'submitting';
  const seedings     = influencer.seedings;

  const [editProfile,  setEditProfile]  = useState(false);
  const [editShipping, setEditShipping] = useState(false);
  const [editNotes,    setEditNotes]    = useState(false);
  const [confirmDelete,   setConfirmDelete]    = useState(false);

  // ── Computed stats ──
  const totalValue  = seedings.reduce((s, sd) => s + (sd.totalCost ?? 0), 0);
  const firstSeeding = seedings.length > 0 ? seedings[seedings.length - 1] : null;
  const lastSeeding  = seedings.length > 0 ? seedings[0] : null;

  const handle   = influencer.handle?.replace(/^@/, '') || '';

  // ── Address derived from seeding history ──
  const lastAddressSeeding = seedings.find(s => s.shippingAddress);
  const lastAddress = lastAddressSeeding?.shippingAddress || influencer.defaultShippingAddress || null;
  const seenAddresses = new Set();
  const addressHistory = seedings
    .filter(s => {
      if (s.shippingAddress && !seenAddresses.has(s.shippingAddress)) {
        seenAddresses.add(s.shippingAddress);
        return true;
      }
      return false;
    })
    .map(s => ({ address: s.shippingAddress, date: s.createdAt, campaign: s.campaign }));

  // ── Style shortcuts ──
  const fieldStyle = {
    padding: '8px 10px', borderRadius: '8px',
    border: '1px solid var(--pt-border)',
    fontSize: '13px', color: 'var(--pt-text)',
    background: 'var(--pt-surface)', width: '100%', boxSizing: 'border-box',
  };
  const btnPrimary = {
    padding: '8px 18px', borderRadius: '8px', border: 'none', cursor: 'pointer',
    fontSize: '13px', fontWeight: '700',
    background: 'linear-gradient(135deg, #7C6FF7 0%, #6558E8 100%)',
    color: '#fff', boxShadow: '0 1px 3px rgba(124,111,247,0.25)',
  };
  const btnNeutral = {
    padding: '8px 14px', borderRadius: '8px', cursor: 'pointer',
    fontSize: '13px', fontWeight: '600',
    border: '1px solid var(--pt-border)',
    backgroundColor: 'var(--pt-surface-high)', color: 'var(--pt-text-sub)',
  };
  const labelStyle = {
    fontSize: '12px', fontWeight: '600', color: 'var(--pt-text-sub)',
    display: 'flex', flexDirection: 'column', gap: '5px',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

      {/* ── Breadcrumb ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
        <Link to="/portal/influencers"
          style={{ fontSize: '13px', color: 'var(--pt-text-sub)', textDecoration: 'none', fontWeight: '500' }}>
          {t('influencer.breadcrumb')}
        </Link>
        <span style={{ color: 'var(--pt-text-muted)', fontSize: '13px' }}>/</span>
        <span style={{ fontSize: '13px', color: 'var(--pt-text)', fontWeight: '600' }}>@{handle}</span>
      </div>

      {/* ── Profile header ── */}
      <Card>
        <div style={{ padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <InstagramAvatar handle={handle} size={52} />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                <span style={{ fontSize: '20px', fontWeight: '800', color: 'var(--pt-text)', letterSpacing: '-0.4px' }}>
                  @{handle}
                </span>
                {influencer.archived && (
                  <span style={{ fontSize: '10px', fontWeight: '700', padding: '2px 8px', borderRadius: '20px', backgroundColor: 'var(--pt-error-bg)', color: 'var(--pt-error-text)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Archived
                  </span>
                )}
              </div>
              {influencer.name && (
                <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--pt-text-sub)', marginBottom: '5px' }}>{influencer.name}</div>
              )}
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                {(influencer.city || influencer.country) && (
                  <span style={{ fontSize: '12px', color: 'var(--pt-text-muted)' }}>
                    📍 {[influencer.city, influencer.country].filter(Boolean).join(', ')}
                  </span>
                )}
                {influencer.gender && (
                  <span style={{ fontSize: '12px', color: 'var(--pt-text-muted)' }}>{influencer.gender}</span>
                )}
                {influencer.followers > 0 && (
                  <span style={{ fontSize: '12px', color: 'var(--pt-text-muted)' }}>{fmtNum(influencer.followers)} followers</span>
                )}
                {influencer.email && (
                  <a href={`mailto:${influencer.email}`} style={{ fontSize: '12px', color: 'var(--pt-accent)', textDecoration: 'none' }}>
                    {influencer.email}
                  </a>
                )}
                {influencer.phone && (
                  <a href={`tel:${influencer.phone}`} style={{ fontSize: '12px', color: 'var(--pt-text-muted)', textDecoration: 'none' }}>
                    {influencer.phone}
                  </a>
                )}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
            {canEdit && (
              <EditBtn onClick={() => { setEditProfile(v => !v); setEditShipping(false); }} active={editProfile} label={editProfile ? 'Cancel' : 'Edit Profile'} />
            )}
            <a href={`https://www.instagram.com/${handle}/`} target="_blank" rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: '600', textDecoration: 'none', background: 'linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)', color: '#fff' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4.5" stroke="white" strokeWidth="2"/><rect x="1.5" y="1.5" width="21" height="21" rx="6" stroke="white" strokeWidth="2"/><circle cx="17.5" cy="6.5" r="1.2" fill="white"/></svg>
              Instagram
            </a>
          </div>
        </div>

        {/* Inline profile edit form */}
        {editProfile && canEdit && (
          <div style={{ borderTop: '1px solid var(--pt-border)', padding: '20px' }}>
            <Form method="post" onSubmit={() => setEditProfile(false)}>
              <input type="hidden" name="intent" value="updateProfile" />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '16px' }}>
                <label style={labelStyle}>
                  Instagram Handle
                  <input name="handle" type="text" defaultValue={influencer.handle} style={fieldStyle} />
                </label>
                <label style={labelStyle}>
                  Full Name
                  <input name="name" type="text" defaultValue={influencer.name || ''} style={fieldStyle} />
                </label>
                <label style={labelStyle}>
                  Gender
                  <select name="gender" defaultValue={influencer.gender || ''} style={fieldStyle}>
                    <option value="">— Not specified —</option>
                    {['Female','Male','Non-binary','Other'].map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </label>
                <label style={labelStyle}>
                  Email
                  <input name="email" type="email" defaultValue={influencer.email || ''} style={fieldStyle} />
                </label>
                <label style={labelStyle}>
                  Phone
                  <input name="phone" type="tel" defaultValue={influencer.phone || ''} placeholder="+1 555 000 0000" style={fieldStyle} />
                </label>
                <label style={labelStyle}>
                  Followers
                  <input name="followers" type="number" defaultValue={influencer.followers || ''} style={fieldStyle} />
                </label>
                <label style={labelStyle}>
                  Country
                  <select name="country" defaultValue={influencer.country || ''} style={fieldStyle}>
                    <option value="">— Select —</option>
                    {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label style={labelStyle}>
                  City
                  <input name="city" type="text" defaultValue={influencer.city || ''} placeholder="e.g. Paris" style={fieldStyle} />
                </label>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="submit" disabled={isSubmitting} style={{ ...btnPrimary, opacity: isSubmitting ? 0.7 : 1 }}>
                  {isSubmitting ? 'Saving…' : 'Save Changes'}
                </button>
                <button type="button" onClick={() => setEditProfile(false)} style={btnNeutral}>Cancel</button>
              </div>
            </Form>
          </div>
        )}
      </Card>

      {/* ── KPI strip ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
        {[
          { label: 'Total Seedings',   value: seedings.length,             accent: false },
          { label: 'Total Value Sent', value: `€${fmtNum(totalValue)}`,    accent: 'var(--pt-accent)' },
          { label: 'First Seeding',    value: firstSeeding ? fmtDate(firstSeeding.createdAt) : '—', accent: false },
          { label: 'Last Seeding',     value: lastSeeding  ? fmtDate(lastSeeding.createdAt)  : '—', accent: false },
        ].map(({ label, value, accent }) => (
          <div key={label} style={{
            backgroundColor: 'var(--pt-surface)',
            border: '1px solid var(--pt-border)',
            borderRadius: '14px',
            padding: '16px 18px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}>
            <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--pt-text-muted)', marginBottom: '6px' }}>{label}</div>
            <div style={{ fontSize: '22px', fontWeight: '800', letterSpacing: '-0.5px', lineHeight: 1, color: accent || 'var(--pt-text)' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* ── Shipping + Sizes ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>

        {/* Shipping info */}
        <Card>
          <CardHeader
            title="Shipping Info"
            right={canEdit && (
              <EditBtn onClick={() => { setEditShipping(v => !v); setEditProfile(false); }} active={editShipping} label={editShipping ? 'Cancel' : (lastAddress ? 'Edit' : 'Add')} />
            )}
          />
          {editShipping && canEdit ? (
            <div style={{ padding: '16px 20px' }}>
              <Form method="post" onSubmit={() => setEditShipping(false)}>
                <input type="hidden" name="intent" value="updateShipping" />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' }}>
                  <label style={labelStyle}>
                    Full Address
                    <textarea name="defaultShippingAddress" defaultValue={lastAddress || ''} rows={3}
                      placeholder="Street, city, postal code, country…"
                      style={{ ...fieldStyle, resize: 'vertical' }} />
                  </label>
                  <label style={labelStyle}>
                    Delivery Notes
                    <input name="shippingNotes" type="text" defaultValue={influencer.shippingNotes || ''}
                      placeholder="e.g. leave at door, ring bell #3…"
                      style={fieldStyle} />
                  </label>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="submit" disabled={isSubmitting} style={{ ...btnPrimary, opacity: isSubmitting ? 0.7 : 1 }}>
                    {isSubmitting ? 'Saving…' : 'Save'}
                  </button>
                  <button type="button" onClick={() => setEditShipping(false)} style={btnNeutral}>Cancel</button>
                </div>
              </Form>
            </div>
          ) : (
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.7px', color: 'var(--pt-text-muted)' }}>Address</div>
                  {lastAddressSeeding ? (
                    <span style={{ fontSize: '10px', color: 'var(--pt-text-muted)', fontStyle: 'italic' }}>
                      From seeding · {fmtDate(lastAddressSeeding.createdAt)}
                      {lastAddressSeeding.campaign ? ` · ${lastAddressSeeding.campaign.title}` : ''}
                    </span>
                  ) : lastAddress ? (
                    <span style={{ fontSize: '10px', color: 'var(--pt-text-muted)', fontStyle: 'italic' }}>Manually set</span>
                  ) : null}
                </div>
                {lastAddress ? (
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--pt-text)', lineHeight: '1.6', whiteSpace: 'pre-line' }}>{lastAddress}</p>
                ) : (
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--pt-text-muted)', fontStyle: 'italic' }}>No address saved — will auto-fill from first seeding</p>
                )}
              </div>
              {addressHistory.length > 1 && (
                <div>
                  <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.7px', color: 'var(--pt-text-muted)', marginBottom: '6px' }}>
                    Previous Addresses
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {addressHistory.slice(1, 4).map((h, i) => (
                      <div key={i} style={{ fontSize: '11px', color: 'var(--pt-text-sub)', lineHeight: '1.5', padding: '6px 10px', borderRadius: '7px', backgroundColor: 'var(--pt-surface-high)', border: '1px solid var(--pt-border)' }}>
                        <div style={{ fontWeight: '600', marginBottom: '2px', whiteSpace: 'pre-line', fontSize: '12px' }}>{h.address}</div>
                        <div style={{ color: 'var(--pt-text-muted)', fontSize: '10px' }}>
                          {fmtDate(h.date)}{h.campaign ? ` · ${h.campaign.title}` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {influencer.shippingNotes && (
                <div>
                  <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.7px', color: 'var(--pt-text-muted)', marginBottom: '6px' }}>Delivery Notes</div>
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--pt-text-sub)', lineHeight: '1.5' }}>{influencer.shippingNotes}</p>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Saved Sizes */}
        <Card>
          <CardHeader title={t('influencer.sizes.title')} />
          <div style={{ padding: '16px 20px' }}>
            {canEdit ? (
              <Form method="post">
                <input type="hidden" name="intent" value="updateSizes" />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' }}>
                  {[
                    { category: 'tops',     sizes: ['XS','S','M','L','XL','XXL'] },
                    { category: 'bottoms',  sizes: ['XS','S','M','L','XL','XXL'] },
                    { category: 'footwear', sizes: ['35','36','37','38','39','40','41','42','43','44','45','5','5.5','6','6.5','7','7.5','8','8.5','9','9.5','10','10.5','11'] },
                  ].map(({ category, sizes }) => {
                    const saved = savedSizes.find(s => s.category === category)?.size ?? '';
                    return (
                      <label key={category} style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12px', fontWeight: '600', color: 'var(--pt-text-sub)' }}>
                        <span style={{ minWidth: '64px', textTransform: 'capitalize' }}>{t(`influencer.sizes.${category}`)}</span>
                        <select name={`size_${category}`} defaultValue={saved} onChange={e => e.target.form.requestSubmit()}
                          style={{ ...fieldStyle, flex: 1 }}>
                          <option value="">{t('influencer.sizes.notSet')}</option>
                          {sizes.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </label>
                    );
                  })}
                </div>
                <button type="submit" disabled={isSubmitting} style={{ ...btnPrimary, opacity: isSubmitting ? 0.7 : 1 }}>
                  {isSubmitting ? t('influencer.sizes.saving') : t('influencer.sizes.save')}
                </button>
              </Form>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {savedSizes.length === 0 ? (
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--pt-text-muted)', fontStyle: 'italic' }}>No sizes saved.</p>
                ) : savedSizes.map(s => (
                  <div key={s.category} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '4px 0', borderBottom: '1px solid var(--pt-border-light)' }}>
                    <span style={{ color: 'var(--pt-text-sub)', textTransform: 'capitalize' }}>{s.category}</span>
                    <span style={{ fontWeight: '700', color: 'var(--pt-text)' }}>{s.size}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* ── Notes ── */}
      <Card>
          <CardHeader
            title={t('influencer.notes.title')}
            right={canEdit && !editNotes && (
              <EditBtn onClick={() => setEditNotes(true)} active={false} label={influencer.notes ? 'Edit' : 'Add'} />
            )}
          />
          <div style={{ padding: '16px 20px' }}>
            {editNotes ? (
              <Form method="post" onSubmit={() => setEditNotes(false)}>
                <input type="hidden" name="intent" value="updateNotes" />
                <textarea name="notes" defaultValue={influencer.notes || ''} rows={5}
                  placeholder="e.g. prefers DMs, waiting on address, loves unboxing content…"
                  onKeyDown={e => { if (e.key === 'Escape') setEditNotes(false); }}
                  style={{ ...fieldStyle, resize: 'vertical', display: 'block', marginBottom: '10px' }}
                />
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button type="submit" disabled={isSubmitting} style={{ ...btnPrimary, padding: '8px 18px', opacity: isSubmitting ? 0.7 : 1 }}>
                    {isSubmitting ? 'Saving…' : 'Save'}
                  </button>
                  <button type="button" onClick={() => setEditNotes(false)} style={{ ...btnNeutral, padding: '8px 12px' }}>Cancel</button>
                </div>
              </Form>
            ) : (
              <p style={{ margin: 0, fontSize: '13px', color: influencer.notes ? 'var(--pt-text)' : 'var(--pt-text-muted)', fontStyle: influencer.notes ? 'normal' : 'italic', lineHeight: '1.7', whiteSpace: 'pre-wrap' }}>
                {influencer.notes || 'No notes yet.'}
              </p>
            )}
          </div>
        </Card>

      {/* ── Seeding history ── */}
      <Card>
        <CardHeader
          title="Seeding History"
          right={<span style={{ fontSize: '11px', color: 'var(--pt-text-sub)' }}>{seedings.length} total</span>}
        />
        {seedings.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: 'var(--pt-text-muted)', fontSize: '13px' }}>
            No seedings yet.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--pt-bg)' }}>
                {['Date', 'Campaign', 'Items', 'Value', 'Status', 'Tracking'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 16px', color: 'var(--pt-text-muted)', fontWeight: '700', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.6px', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {seedings.map(s => (
                <tr key={s.id} style={{ borderTop: '1px solid var(--pt-border-light)' }}>
                  <td style={{ padding: '11px 16px', color: 'var(--pt-text-muted)', whiteSpace: 'nowrap', fontSize: '12px' }}>
                    {fmtDate(s.createdAt)}
                  </td>
                  <td style={{ padding: '11px 16px' }}>
                    {s.campaign
                      ? <Link to={`/portal/campaigns/${s.campaign.id}`} style={{ color: 'var(--pt-accent)', fontWeight: '600', textDecoration: 'none', fontSize: '12px' }}>{s.campaign.title}</Link>
                      : <span style={{ color: 'var(--pt-text-muted)', fontSize: '12px' }}>—</span>}
                  </td>
                  <td style={{ padding: '11px 16px', color: 'var(--pt-text-sub)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '12px' }}>
                    {s.products.map(p => p.productName).join(', ') || '—'}
                  </td>
                  <td style={{ padding: '11px 16px', fontWeight: '700', color: 'var(--pt-text)', whiteSpace: 'nowrap', fontSize: '13px' }}>
                    €{(s.totalCost ?? 0).toFixed(2)}
                  </td>
                  <td style={{ padding: '11px 16px' }}>
                    <StatusPill status={s.status} />
                  </td>
                  <td style={{ padding: '11px 16px' }}>
                    {s.trackingUrl ? (
                      <a href={s.trackingUrl} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: '12px', color: 'var(--pt-accent)', fontWeight: '600', textDecoration: 'none' }}>
                        {s.trackingCarrier ? `${s.trackingCarrier} ↗` : 'Track ↗'}
                      </a>
                    ) : s.trackingNumber ? (
                      <span style={{ fontSize: '12px', color: 'var(--pt-text-sub)', fontFamily: 'monospace' }}>{s.trackingNumber}</span>
                    ) : (
                      <span style={{ fontSize: '11px', color: 'var(--pt-text-muted)', fontStyle: 'italic' }}>No tracking</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* ── Danger zone ── */}
      {canEdit && (
        <Card>
          <CardHeader title={t('influencer.danger.title')} />
          <div style={{ padding: '16px 20px', display: 'flex', gap: '10px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <Form method="post">
              <input type="hidden" name="intent" value={influencer.archived ? 'unarchive' : 'archive'} />
              <button type="submit" disabled={isSubmitting} style={{ ...btnNeutral, opacity: isSubmitting ? 0.7 : 1 }}>
                {influencer.archived ? t('influencer.danger.unarchive') : t('influencer.danger.archive')}
              </button>
            </Form>

            {!confirmDelete ? (
              <button type="button" onClick={() => setConfirmDelete(true)}
                style={{ padding: '8px 18px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: '700', background: 'linear-gradient(135deg, #DC2626 0%, #B91C1C 100%)', color: '#fff', boxShadow: '0 1px 3px rgba(220,38,38,0.2)' }}>
                {t('influencer.danger.delete')}
              </button>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', borderRadius: '10px', border: '1px solid var(--pt-border)', backgroundColor: 'var(--pt-surface-high)' }}>
                <span style={{ fontSize: '13px', color: 'var(--pt-text)' }}>
                  {t('influencer.danger.confirmDelete', { handle })}
                </span>
                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                  <Form method="post">
                    <input type="hidden" name="intent" value="delete" />
                    <button type="submit" disabled={isSubmitting}
                      style={{ padding: '7px 14px', borderRadius: '7px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: '700', background: 'linear-gradient(135deg, #DC2626 0%, #B91C1C 100%)', color: '#fff', opacity: isSubmitting ? 0.7 : 1 }}>
                      {isSubmitting ? t('influencer.danger.deleting') : t('influencer.danger.confirmYes')}
                    </button>
                  </Form>
                  <button type="button" onClick={() => setConfirmDelete(false)} style={{ ...btnNeutral, padding: '7px 12px' }}>
                    {t('influencer.danger.cancel')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

    </div>
  );
}
