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
    const email     = formData.get('email')     ? String(formData.get('email')).slice(0, 254).trim().toLowerCase() : null;
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
    const inf = await prisma.influencer.findUnique({ where: { id }, select: { handle: true, shop: true } });
    if (!inf || inf.shop !== shop) return null; // guard: can't delete another shop's influencer
    const seedingIds = (await prisma.seeding.findMany({ where: { shop, influencerId: id }, select: { id: true } })).map(s => s.id);
    if (seedingIds.length > 0) {
      // Release any assigned discount codes back to the pool before deleting
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

// ── Shared design tokens ──────────────────────────────────────────────────────
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

// ── Shared card components (matching dashboard) ───────────────────────────────
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
      padding: '14px 20px', borderBottom: '1px solid var(--pt-border)',
    }}>
      <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--pt-text-muted)' }}>
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

// ── Component ─────────────────────────────────────────────────────────────────
export default function PortalInfluencerDetail() {
  const { influencer, canEdit, savedSizes } = useLoaderData();
  const navigation   = useNavigation();
  const { t }        = useT();
  const isSubmitting = navigation.state === 'submitting';
  const seedings     = influencer.seedings;

  const [editProfile,   setEditProfile]   = useState(false);
  const [editNotes,     setEditNotes]     = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const totalValue = seedings.reduce((s, sd) => s + (sd.totalCost ?? 0), 0);
  const totalUnits = seedings.reduce((s, sd) => s + (sd.products?.length ?? 0), 0);
  const avgValue   = seedings.length > 0 ? totalValue / seedings.length : 0;

  const statusCounts = STATUSES.reduce((acc, s) => {
    acc[s] = seedings.filter(sd => sd.status === s).length;
    return acc;
  }, {});

  const productMap = {};
  for (const sd of seedings) {
    for (const p of sd.products || []) {
      productMap[p.productName] = (productMap[p.productName] || 0) + 1;
    }
  }
  const topProducts  = Object.entries(productMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxProduct   = topProducts[0]?.[1] || 1;

  const handle   = influencer.handle?.replace(/^@/, '') || '';
  const initials = handle.slice(0, 2).toUpperCase() || '?';

  const fieldStyle = {
    padding: '8px 10px', borderRadius: '8px',
    border: '1px solid var(--pt-border)',
    fontSize: '13px', color: 'var(--pt-text)',
    background: 'var(--pt-surface)', width: '100%', boxSizing: 'border-box',
  };

  const btnPrimary = {
    padding: '9px 20px', borderRadius: '8px', border: 'none', cursor: 'pointer',
    fontSize: '13px', fontWeight: '700',
    background: 'linear-gradient(135deg, #7C6FF7 0%, #6558E8 100%)',
    color: '#fff', boxShadow: '0 1px 3px rgba(124,111,247,0.25)',
  };
  const btnNeutral = {
    padding: '9px 14px', borderRadius: '8px', cursor: 'pointer',
    fontSize: '13px', fontWeight: '600',
    border: '1px solid var(--pt-border)',
    backgroundColor: 'var(--pt-surface-high)', color: 'var(--pt-text-sub)',
  };

  return (
    <div style={{ maxWidth: '1100px', display: 'flex', flexDirection: 'column', gap: '12px' }}>

      {/* ── Breadcrumb ────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
        <Link to="/portal/influencers"
          style={{ fontSize: '13px', color: 'var(--pt-text-sub)', textDecoration: 'none', fontWeight: '500' }}>
          {t('influencer.breadcrumb')}
        </Link>
        <span style={{ color: 'var(--pt-text-muted)', fontSize: '13px' }}>/</span>
        <span style={{ fontSize: '13px', color: 'var(--pt-text)', fontWeight: '600' }}>@{handle}</span>
      </div>

      {/* ── Profile header card ───────────────────────────────── */}
      <Card>
        <div style={{ padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <InstagramAvatar handle={handle} size={52} />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                <span style={{ fontSize: '18px', fontWeight: '800', color: 'var(--pt-text)', letterSpacing: '-0.3px' }}>
                  @{handle}
                </span>
                {influencer.archived && (
                  <span style={{ fontSize: '10px', fontWeight: '700', padding: '2px 8px', borderRadius: '20px', backgroundColor: 'var(--pt-error-bg)', color: 'var(--pt-error-text)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Archived
                  </span>
                )}
              </div>
              {influencer.name && (
                <div style={{ fontSize: '13px', color: 'var(--pt-text-sub)', marginBottom: '6px' }}>{influencer.name}</div>
              )}
              <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                {influencer.country && (
                  <span style={{ fontSize: '12px', color: 'var(--pt-text-muted)' }}>{influencer.country}</span>
                )}
                {influencer.followers > 0 && (
                  <span style={{ fontSize: '12px', color: 'var(--pt-text-muted)' }}>{fmtNum(influencer.followers)} followers</span>
                )}
                {influencer.email && (
                  <a href={`mailto:${influencer.email}`} style={{ fontSize: '12px', color: 'var(--pt-accent)', textDecoration: 'none' }}>
                    {influencer.email}
                  </a>
                )}
              </div>
            </div>
          </div>

          {canEdit && (
            <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
              <button type="button" onClick={() => setEditProfile(v => !v)}
                style={{ ...btnNeutral, color: editProfile ? 'var(--pt-accent)' : 'var(--pt-text-sub)', backgroundColor: editProfile ? 'var(--pt-accent-light)' : 'var(--pt-surface-high)', borderColor: editProfile ? 'var(--pt-accent)' : 'var(--pt-border)' }}>
                {editProfile ? t('common.cancel') : t('influencer.editProfile')}
              </button>
              <a href={`https://www.instagram.com/${handle}/`} target="_blank" rel="noopener noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '9px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: '600', textDecoration: 'none', background: 'linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)', color: '#fff' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4.5" stroke="white" strokeWidth="2"/><rect x="1.5" y="1.5" width="21" height="21" rx="6" stroke="white" strokeWidth="2"/><circle cx="17.5" cy="6.5" r="1.2" fill="white"/></svg>
                Instagram
              </a>
            </div>
          )}
        </div>

        {/* Edit profile form — inline under header */}
        {editProfile && canEdit && (
          <div style={{ borderTop: '1px solid var(--pt-border)', padding: '20px' }}>
            <Form method="post" onSubmit={() => setEditProfile(false)}>
              <input type="hidden" name="intent" value="updateProfile" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
                {[
                  { name: 'handle',    label: 'Instagram Handle', defaultValue: influencer.handle,          type: 'text'   },
                  { name: 'name',      label: 'Full Name',        defaultValue: influencer.name || '',      type: 'text'   },
                  { name: 'followers', label: 'Followers',        defaultValue: influencer.followers || '', type: 'number' },
                  { name: 'email',     label: 'Email',            defaultValue: influencer.email || '',     type: 'email'  },
                ].map(f => (
                  <label key={f.name} style={{ fontSize: '12px', fontWeight: '600', color: 'var(--pt-text-sub)', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    {f.label}
                    <input name={f.name} type={f.type} defaultValue={f.defaultValue} style={fieldStyle} />
                  </label>
                ))}
                <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--pt-text-sub)', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  Country
                  <select name="country" defaultValue={influencer.country || ''} style={fieldStyle}>
                    <option value="">— Select —</option>
                    {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="submit" disabled={isSubmitting} style={{ ...btnPrimary, opacity: isSubmitting ? 0.7 : 1 }}>
                  {isSubmitting ? t('influencer.profile.saving') : t('influencer.profile.saveChanges')}
                </button>
                <button type="button" onClick={() => setEditProfile(false)} style={btnNeutral}>
                  {t('influencer.profile.cancel')}
                </button>
              </div>
            </Form>
          </div>
        )}
      </Card>

      {/* ── KPI row (matching dashboard style) ───────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
        {[
          { label: t('influencer.kpi.totalSeedings'), value: seedings.length,              accent: false },
          { label: t('influencer.kpi.totalValue'),    value: `€${fmtNum(totalValue)}`,     accent: 'var(--pt-accent)' },
          { label: t('influencer.kpi.unitsSent'),     value: totalUnits,                   accent: false },
          { label: t('influencer.kpi.avgPerSend'),    value: `€${Math.round(avgValue)}`,   accent: 'var(--pt-purple)' },
        ].map(({ label, value, accent }) => (
          <div key={label} style={{
            backgroundColor: 'var(--pt-surface)',
            border: '1px solid var(--pt-border)',
            borderRadius: '14px',
            padding: '16px 18px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}>
            <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--pt-text-muted)', marginBottom: '6px' }}>
              {label}
            </div>
            <div style={{ fontSize: '26px', fontWeight: '800', letterSpacing: '-0.8px', lineHeight: 1, color: accent || 'var(--pt-text)' }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* ── Status breakdown + Top products ──────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>

        <Card>
          <CardHeader title={t('influencer.statusBreakdown')} />
          <div style={{ padding: '8px 0' }}>
            {STATUSES.filter(s => statusCounts[s] > 0).length === 0 ? (
              <div style={{ padding: '20px', fontSize: '13px', color: 'var(--pt-text-muted)' }}>No seedings yet.</div>
            ) : STATUSES.filter(s => statusCounts[s] > 0).map(s => (
              <div key={s} style={{ padding: '9px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                <StatusPill status={s} />
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '80px', height: '3px', backgroundColor: 'var(--pt-surface-high)', borderRadius: '99px', overflow: 'hidden' }}>
                    <div style={{ width: `${(statusCounts[s] / seedings.length) * 100}%`, height: '100%', backgroundColor: STATUS_COLORS[s]?.dot || 'var(--pt-accent)', borderRadius: '99px' }} />
                  </div>
                  <span style={{ fontSize: '13px', fontWeight: '800', color: 'var(--pt-text)', minWidth: '20px', textAlign: 'right' }}>{statusCounts[s]}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title={t('influencer.mostSeededProducts')} />
          <div style={{ padding: '8px 0' }}>
            {topProducts.length === 0 ? (
              <div style={{ padding: '20px', fontSize: '13px', color: 'var(--pt-text-muted)' }}>No products yet.</div>
            ) : topProducts.map(([name, count], i) => (
              <div key={name} style={{ padding: '9px 20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--pt-text-muted)', minWidth: '16px' }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--pt-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                    <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--pt-text)', flexShrink: 0, marginLeft: '8px' }}>{count}×</span>
                  </div>
                  <div style={{ height: '3px', backgroundColor: 'var(--pt-surface-high)', borderRadius: '99px', overflow: 'hidden' }}>
                    <div style={{ width: `${(count / maxProduct) * 100}%`, height: '100%', backgroundColor: 'var(--pt-purple)', borderRadius: '99px' }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* ── Notes + Saved Sizes ───────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>

        {/* Notes */}
        <Card>
          <CardHeader
            title={t('influencer.notes.title')}
            right={canEdit && !editNotes && (
              <button type="button" onClick={() => setEditNotes(true)}
                style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--pt-border)', cursor: 'pointer', fontSize: '11px', fontWeight: '600', backgroundColor: 'transparent', color: 'var(--pt-text-sub)' }}>
                {influencer.notes ? t('influencer.notes.edit') : t('influencer.notes.add')}
              </button>
            )}
          />
          <div style={{ padding: '16px 20px' }}>
            {editNotes ? (
              <Form method="post" onSubmit={() => setEditNotes(false)}>
                <input type="hidden" name="intent" value="updateNotes" />
                <textarea name="notes" defaultValue={influencer.notes || ''} rows={4}
                  placeholder="e.g. prefers DM, waiting on address, loves unboxing content…"
                  onKeyDown={e => { if (e.key === 'Escape') setEditNotes(false); }}
                  style={{ ...fieldStyle, resize: 'vertical', display: 'block', marginBottom: '10px' }}
                />
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button type="submit" disabled={isSubmitting} style={{ ...btnPrimary, padding: '8px 18px', opacity: isSubmitting ? 0.7 : 1 }}>
                    {isSubmitting ? t('influencer.notes.saving') : t('influencer.notes.save')}
                  </button>
                  <button type="button" onClick={() => setEditNotes(false)} style={{ ...btnNeutral, padding: '8px 12px' }}>
                    {t('influencer.notes.cancel')}
                  </button>
                </div>
              </Form>
            ) : (
              <p style={{ margin: 0, fontSize: '13px', color: influencer.notes ? 'var(--pt-text)' : 'var(--pt-text-muted)', fontStyle: influencer.notes ? 'normal' : 'italic', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
                {influencer.notes || 'No notes yet.'}
              </p>
            )}
          </div>
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
                        <span style={{ minWidth: '60px' }}>{t(`influencer.sizes.${category}`)}</span>
                        <select name={`size_${category}`} defaultValue={saved}
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
                  <div key={s.category} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                    <span style={{ color: 'var(--pt-text-sub)', textTransform: 'capitalize' }}>{s.category}</span>
                    <span style={{ fontWeight: '700', color: 'var(--pt-text)' }}>{s.size}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* ── Danger zone ───────────────────────────────────────── */}
      {canEdit && (
        <Card>
          <CardHeader title={t('influencer.danger.title')} />
          <div style={{ padding: '16px 20px', display: 'flex', gap: '10px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <Form method="post">
              <input type="hidden" name="intent" value={influencer.archived ? 'unarchive' : 'archive'} />
              <button type="submit" disabled={isSubmitting}
                style={{ ...btnNeutral, opacity: isSubmitting ? 0.7 : 1 }}>
                {influencer.archived ? t('influencer.danger.unarchive') : t('influencer.danger.archive')}
              </button>
            </Form>

            {!confirmDelete ? (
              <button type="button" onClick={() => setConfirmDelete(true)}
                style={{ padding: '9px 18px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: '700', background: 'linear-gradient(135deg, #DC2626 0%, #B91C1C 100%)', color: '#fff', boxShadow: '0 1px 3px rgba(220,38,38,0.2)' }}>
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
                  <button type="button" onClick={() => setConfirmDelete(false)}
                    style={{ ...btnNeutral, padding: '7px 12px' }}>
                    {t('influencer.danger.cancel')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ── Seeding history ───────────────────────────────────── */}
      <Card>
        <CardHeader
          title={t('influencer.history.title')}
          right={<span style={{ fontSize: '11px', color: 'var(--pt-text-sub)' }}>{t('influencer.history.total', { count: seedings.length })}</span>}
        />
        {seedings.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: 'var(--pt-text-muted)', fontSize: '13px' }}>
            {t('influencer.history.empty')}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--pt-bg)' }}>
                {[t('influencer.history.date'), t('influencer.history.campaign'), t('influencer.history.products'), t('influencer.history.value'), t('influencer.history.status')].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 16px', color: 'var(--pt-text-muted)', fontWeight: '700', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.6px' }}>{h}</th>
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
                  <td style={{ padding: '11px 16px', color: 'var(--pt-text-sub)', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '12px' }}>
                    {s.products.map(p => p.productName).join(', ') || '—'}
                  </td>
                  <td style={{ padding: '11px 16px', fontWeight: '700', color: 'var(--pt-text)', whiteSpace: 'nowrap', fontSize: '13px' }}>
                    €{(s.totalCost ?? 0).toFixed(2)}
                  </td>
                  <td style={{ padding: '11px 16px' }}>
                    <StatusPill status={s.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

    </div>
  );
}
