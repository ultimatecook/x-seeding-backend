import { useState } from 'react';
import { useLoaderData, Form, Link, redirect } from 'react-router';
import prisma from '../db.server';
import { requirePortalUser } from '../utils/portal-auth.server';
import { can, requirePermission } from '../utils/portal-permissions';
import { audit } from '../utils/audit.server.js';
import { fmtDate, fmtNum } from '../theme';
import { D, Pinput as input } from '../utils/portal-theme';
import { useT } from '../utils/i18n';
import { releaseDiscountCodes } from '../utils/discount-codes.server';

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS_META = {
  Pending:   { bg: D.statusPending.bg,   text: D.statusPending.color,   dot: D.statusPending.dot   },
  Ordered:   { bg: D.statusOrdered.bg,   text: D.statusOrdered.color,   dot: D.statusOrdered.dot   },
  Shipped:   { bg: D.statusShipped.bg,   text: D.statusShipped.color,   dot: D.statusShipped.dot   },
  Delivered: { bg: D.statusDelivered.bg, text: D.statusDelivered.color, dot: D.statusDelivered.dot },
  Posted:    { bg: D.statusPosted.bg,    text: D.statusPosted.color,    dot: D.statusPosted.dot    },
};
const STATUSES = ['Pending', 'Ordered', 'Shipped', 'Delivered', 'Posted'];

const GUEST_STATUS = {
  invited:   { label: 'Invited',   bg: 'rgba(100,116,139,0.10)', text: '#475569', dot: '#94A3B8' },
  confirmed: { label: 'Confirmed', bg: 'rgba(59,130,246,0.10)',  text: '#2563EB', dot: '#3B82F6' },
  attended:  { label: 'Attended',  bg: 'rgba(16,185,129,0.10)',  text: '#059669', dot: '#10B981' },
};

const ALLOC = {
  ok:   { bar: '#7C6FF7', badge: 'rgba(124,111,247,0.10)', text: '#7C6FF7' },
  warn: { bar: '#F59E0B', badge: 'rgba(245,158,11,0.12)',  text: '#D97706' },
  full: { bar: '#EF4444', badge: 'rgba(239,68,68,0.10)',   text: '#DC2626' },
};
function allocTier(used, allocated) {
  if (!allocated) return 'ok';
  const pct = (used / allocated) * 100;
  if (pct >= 100) return 'full';
  if (pct >= 75)  return 'warn';
  return 'ok';
}

// ── Loader ────────────────────────────────────────────────────────────────────
export async function loader({ request, params }) {
  const { shop, portalUser } = await requirePortalUser(request);
  requirePermission(portalUser.role, 'viewCampaigns');

  const id = parseInt(params.id);
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      products: true,
      seedings: {
        select: {
          id: true, status: true, trackingNumber: true, totalCost: true, createdAt: true,
          influencer: { select: { id: true, handle: true, name: true, country: true } },
          products:   { select: { id: true, productId: true, productName: true, price: true, imageUrl: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
      guests: {
        include: { items: true, influencer: { select: { id: true, handle: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!campaign || campaign.shop !== shop) throw new Response('Not Found', { status: 404 });

  // Compute per-product used units (from seedings + unfulfilled guest items)
  const usedBySeedings = {};
  for (const s of campaign.seedings) {
    for (const sp of s.products) {
      usedBySeedings[sp.productId] = (usedBySeedings[sp.productId] || 0) + 1;
    }
  }
  const usedByGuests = {};
  for (const g of campaign.guests) {
    for (const gi of g.items) {
      if (!gi.fulfilled) {
        usedByGuests[gi.productId] = (usedByGuests[gi.productId] || 0) + (gi.quantity || 1);
      }
    }
  }

  const products = campaign.products.map(cp => {
    const used      = (usedBySeedings[cp.productId] || 0) + (usedByGuests[cp.productId] || 0);
    return {
      ...cp,
      usedUnits:      used,
      remainingUnits: cp.allocatedUnits != null ? Math.max(0, cp.allocatedUnits - used) : null,
    };
  });

  const budgetUsed = campaign.seedings.reduce((s, x) => s + (x.totalCost || 0), 0);

  // Influencers for the "link guest" picker
  const influencers = campaign.type === 'event'
    ? await prisma.influencer.findMany({ where: { shop, archived: false }, orderBy: { name: 'asc' }, select: { id: true, handle: true, name: true } })
    : [];

  return {
    campaign: { ...campaign, products, budgetUsed },
    influencers,
    role: portalUser.role,
    canDelete: can.deleteCampaign(portalUser.role),
  };
}

// ── Action ────────────────────────────────────────────────────────────────────
export async function action({ request, params }) {
  const { shop, portalUser } = await requirePortalUser(request);
  requirePermission(portalUser.role, 'updateSeeding');

  const formData = await request.formData();
  const intent   = formData.get('intent');
  const campId   = parseInt(params.id);

  // ── Seeding management ───────────────────────────────────────────────────
  if (intent === 'updateStatus') {
    const id     = parseInt(formData.get('seedingId'));
    const status = formData.get('status');
    if (!STATUSES.includes(status)) return null;
    await prisma.seeding.update({ where: { id }, data: { status } });
    await audit({ shop, portalUser, action: 'updated_status', entityType: 'seeding', entityId: id, detail: `Status → ${status}` });
    return null;
  }

  if (intent === 'updateTracking') {
    const id             = parseInt(formData.get('seedingId'));
    const trackingNumber = String(formData.get('trackingNumber') || '').slice(0, 200).trim() || null;
    await prisma.seeding.update({ where: { id }, data: { trackingNumber } });
    await audit({ shop, portalUser, action: 'updated_tracking', entityType: 'seeding', entityId: id, detail: `Tracking → ${trackingNumber ?? 'cleared'}` });
    return null;
  }

  if (intent === 'deleteSeeding') {
    requirePermission(portalUser.role, 'deleteSeeding');
    const id = parseInt(formData.get('seedingId'));
    const seeding = await prisma.seeding.findUnique({ where: { id }, include: { influencer: true } });
    await releaseDiscountCodes(shop, id);
    await prisma.seeding.delete({ where: { id } });
    await audit({ shop, portalUser, action: 'deleted_seeding', entityType: 'seeding', entityId: id, detail: `Deleted seeding for ${seeding?.influencer?.handle ?? id}` });
    return null;
  }

  // ── Campaign management ──────────────────────────────────────────────────
  if (intent === 'archive' || intent === 'unarchive') {
    requirePermission(portalUser.role, 'editCampaign');
    const archived = intent === 'archive';
    const existing = await prisma.campaign.findUnique({ where: { id: campId }, select: { shop: true, title: true } });
    if (!existing || existing.shop !== shop) throw new Response('Not Found', { status: 404 });
    await prisma.campaign.update({ where: { id: campId }, data: { archived } });
    await audit({ shop, portalUser, action: `${intent}d_campaign`, entityType: 'campaign', entityId: campId, detail: `${archived ? 'Archived' : 'Unarchived'} campaign "${existing.title}"` });
    if (archived) throw redirect('/portal/campaigns');
    return null;
  }

  if (intent === 'deleteCampaign') {
    requirePermission(portalUser.role, 'deleteCampaign');
    const existing = await prisma.campaign.findUnique({ where: { id: campId }, select: { shop: true, title: true } });
    if (!existing || existing.shop !== shop) throw new Response('Not Found', { status: 404 });
    await prisma.campaign.delete({ where: { id: campId } });
    await audit({ shop, portalUser, action: 'deleted_campaign', entityType: 'campaign', entityId: campId, detail: `Deleted campaign "${existing.title}"` });
    throw redirect('/portal/campaigns');
  }

  // ── Guest management ─────────────────────────────────────────────────────
  if (intent === 'addGuest') {
    requirePermission(portalUser.role, 'editCampaign');
    const influencerId = formData.get('guestInfluencerId') ? parseInt(formData.get('guestInfluencerId')) : null;
    if (!influencerId) return null;
    const inf = await prisma.influencer.findUnique({
      where:  { id: influencerId },
      select: { name: true, handle: true, email: true, shop: true },
    });
    if (!inf || inf.shop !== shop) return null;
    const name  = inf.name || `@${inf.handle}`;
    const email = inf.email || null;
    await prisma.campaignGuest.create({ data: { campaignId: campId, name, email, influencerId } });
    return null;
  }

  if (intent === 'updateGuestStatus') {
    const guestId = parseInt(formData.get('guestId'));
    const status  = formData.get('status');
    if (!['invited', 'confirmed', 'attended'].includes(status)) return null;
    const guest = await prisma.campaignGuest.findUnique({ where: { id: guestId }, include: { campaign: true } });
    if (!guest || guest.campaign.shop !== shop) return null;
    await prisma.campaignGuest.update({ where: { id: guestId }, data: { status } });
    return null;
  }

  if (intent === 'updateGuestInfluencer') {
    const guestId      = parseInt(formData.get('guestId'));
    const influencerId = formData.get('influencerId') ? parseInt(formData.get('influencerId')) : null;
    const guest = await prisma.campaignGuest.findUnique({ where: { id: guestId }, include: { campaign: true } });
    if (!guest || guest.campaign.shop !== shop) return null;
    await prisma.campaignGuest.update({ where: { id: guestId }, data: { influencerId } });
    return null;
  }

  if (intent === 'removeGuest') {
    requirePermission(portalUser.role, 'editCampaign');
    const guestId = parseInt(formData.get('guestId'));
    const guest = await prisma.campaignGuest.findUnique({ where: { id: guestId }, include: { campaign: true } });
    if (!guest || guest.campaign.shop !== shop) return null;
    await prisma.campaignGuest.delete({ where: { id: guestId } });
    return null;
  }

  if (intent === 'addGuestItem') {
    const guestId          = parseInt(formData.get('guestId'));
    const campaignProductId = parseInt(formData.get('campaignProductId'));
    const quantity         = Math.max(1, parseInt(formData.get('quantity') || '1'));

    const guest = await prisma.campaignGuest.findUnique({ where: { id: guestId }, include: { campaign: true } });
    if (!guest || guest.campaign.shop !== shop) return null;

    const cp = await prisma.campaignProduct.findUnique({ where: { id: campaignProductId } });
    if (!cp || cp.campaignId !== campId) return null;

    // Check allocation remaining (seedings + guest items combined)
    if (cp.allocatedUnits != null) {
      const [seedingCount, guestCount] = await Promise.all([
        prisma.seedingProduct.count({ where: { productId: cp.productId, seeding: { campaignId: campId } } }),
        prisma.guestItem.aggregate({
          where: { productId: cp.productId, fulfilled: false, guest: { campaignId: campId } },
          _sum: { quantity: true },
        }),
      ]);
      const totalUsed = seedingCount + (guestCount._sum.quantity || 0);
      if (totalUsed + quantity > cp.allocatedUnits) {
        return { error: `Allocation full for "${cp.productName}". Only ${Math.max(0, cp.allocatedUnits - totalUsed)} unit(s) remaining.` };
      }
    }

    await prisma.guestItem.create({
      data: {
        guestId,
        productId:   cp.productId,
        productName: cp.productName,
        imageUrl:    cp.imageUrl,
        price:       0,
        quantity,
      },
    });
    return null;
  }

  if (intent === 'removeGuestItem') {
    const itemId = parseInt(formData.get('itemId'));
    const item = await prisma.guestItem.findUnique({ where: { id: itemId }, include: { guest: { include: { campaign: true } } } });
    if (!item || item.guest.campaign.shop !== shop) return null;
    await prisma.guestItem.delete({ where: { id: itemId } });
    return null;
  }

  return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function StatusPill({ status }) {
  const m = STATUS_META[status] || { bg: D.surfaceHigh, text: D.textSub, dot: D.textMuted };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', backgroundColor: m.bg, color: m.text, borderRadius: '20px', padding: '3px 10px', fontSize: '11px', fontWeight: '700' }}>
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: m.dot, flexShrink: 0 }} />
      {status}
    </span>
  );
}

function BudgetStat({ label, value, color }) {
  return (
    <div style={{ padding: '12px 16px', backgroundColor: D.bg, borderRadius: '8px', border: `1px solid ${D.border}` }}>
      <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.7px', color: D.textMuted, marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: '20px', fontWeight: '800', color, letterSpacing: '-0.5px' }}>{value}</div>
    </div>
  );
}

const sLabel = {
  fontSize: '11px', fontWeight: '700', color: D.textMuted,
  textTransform: 'uppercase', letterSpacing: '0.6px',
  display: 'block', marginBottom: '6px',
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function PortalCampaignDetail() {
  const { campaign, influencers, role, canDelete: canDeleteCampaign } = useLoaderData();
  const { t } = useT();

  const canEdit   = can.updateSeeding(role);
  const canDelete = can.deleteSeeding(role);
  const canCreate = can.createSeeding(role);
  const canManage = can.editCampaign?.(role) ?? canEdit;

  const isEvent = campaign.type === 'event';

  const seedings     = campaign.seedings;
  const guests       = campaign.guests || [];
  const budgetUsed   = campaign.budgetUsed;
  const budgetTotal  = campaign.budget;
  const budgetOver   = budgetTotal != null && budgetUsed > budgetTotal;
  const budgetPct    = budgetTotal ? Math.min(100, (budgetUsed / budgetTotal) * 100) : null;
  const budgetRemain = budgetTotal != null ? budgetTotal - budgetUsed : null;
  const statusCounts = STATUSES.reduce((acc, s) => { acc[s] = seedings.filter(sd => sd.status === s).length; return acc; }, {});

  // Guest stats
  const guestConfirmed = guests.filter(g => g.status === 'confirmed').length;
  const guestAttended  = guests.filter(g => g.status === 'attended').length;
  const totalAssigned  = guests.reduce((s, g) => s + g.items.reduce((a, i) => a + i.quantity, 0), 0);
  const totalFulfilled = guests.reduce((s, g) => s + g.items.filter(i => i.fulfilled).reduce((a, i) => a + i.quantity, 0), 0);

  // UI state
  const [expandedGuest,  setExpandedGuest]  = useState(null); // guestId
  const [showAddGuest,   setShowAddGuest]   = useState(false);
  const [infSearch,      setInfSearch]      = useState('');

  const filteredInf = influencers.filter(inf =>
    !infSearch || inf.handle.toLowerCase().includes(infSearch.toLowerCase()) || (inf.name ?? '').toLowerCase().includes(infSearch.toLowerCase())
  );

  return (
    <div style={{ display: 'grid', gap: '20px' }}>

      {/* Back */}
      <Link to="/portal/campaigns" style={{ fontSize: '13px', color: D.textMuted, textDecoration: 'none' }}>
        ← {t('campaign.backLink').replace('← ', '')}
      </Link>

      {/* ── Header ───────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <h2 style={{ margin: 0, fontSize: '22px', fontWeight: '800', color: D.text, letterSpacing: '-0.3px' }}>
              {isEvent && <span style={{ marginRight: '8px' }}>🎯</span>}
              {campaign.title}
            </h2>
            {campaign.archived && (
              <span style={{ fontSize: '11px', fontWeight: '700', color: D.textMuted, backgroundColor: D.surfaceHigh, border: `1px solid ${D.border}`, borderRadius: '20px', padding: '2px 10px' }}>
                Archived
              </span>
            )}
          </div>
          <div style={{ fontSize: '13px', color: D.textSub, display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
            {isEvent && campaign.eventDate && (
              <span>📅 {fmtDate(campaign.eventDate, 'medium')}</span>
            )}
            {isEvent && campaign.eventLocation && (
              <span>📍 {campaign.eventLocation}</span>
            )}
            {!isEvent && campaign.startDate && (
              <span>{fmtDate(campaign.startDate, 'short')} – {campaign.endDate ? fmtDate(campaign.endDate, 'short') : '…'}</span>
            )}
            <span style={{ color: D.textMuted }}>{t('campaign.created', { date: fmtDate(campaign.createdAt, 'medium') })}</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {canDeleteCampaign && (
            <>
              <Form method="post">
                <input type="hidden" name="intent" value={campaign.archived ? 'unarchive' : 'archive'} />
                <button type="submit" style={{ padding: '8px 14px', borderRadius: '8px', border: `1px solid ${D.border}`, backgroundColor: 'transparent', color: D.textSub, cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
                  {campaign.archived ? t('campaign.restore') : t('campaign.archive')}
                </button>
              </Form>
              {campaign.archived && (
                <Form method="post" onSubmit={e => { if (!confirm(`Permanently delete "${campaign.title}"?`)) e.preventDefault(); }}>
                  <input type="hidden" name="intent" value="deleteCampaign" />
                  <button type="submit" style={{ padding: '8px 14px', borderRadius: '8px', border: `1px solid ${D.errorText}`, backgroundColor: 'transparent', color: D.errorText, cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
                    {t('campaign.delete')}
                  </button>
                </Form>
              )}
            </>
          )}
          {canCreate && !campaign.archived && !isEvent && (
            <Link to="/portal/new" style={{ padding: '8px 18px', background: 'linear-gradient(135deg, #7C6FF7 0%, #9C8FFF 100%)', color: '#fff', borderRadius: '8px', textDecoration: 'none', fontSize: '13px', fontWeight: '700', boxShadow: '0 2px 6px rgba(124,111,247,0.35)' }}>
              {t('campaign.addSeeding')}
            </Link>
          )}
        </div>
      </div>

      {/* ── KPI cards ────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
        {(isEvent ? [
          { label: 'Total Guests',    value: guests.length },
          { label: 'Confirmed',       value: guestConfirmed },
          { label: 'Attended',        value: guestAttended },
          { label: 'Items Fulfilled', value: `${totalFulfilled} / ${totalAssigned}` },
        ] : [
          { label: t('campaign.kpi.seedings'),    value: seedings.length },
          { label: t('campaign.kpi.retailValue'), value: `€${fmtNum(budgetUsed)}` },
          { label: t('campaign.kpi.products'),    value: campaign.products.length },
          { label: t('campaign.kpi.posted'),      value: statusCounts['Posted'] },
        ]).map(stat => (
          <div key={stat.label} style={{ backgroundColor: D.surface, border: `1px solid ${D.border}`, borderRadius: '12px', padding: '18px 20px', boxShadow: D.shadow }}>
            <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.8px', color: D.textMuted, marginBottom: '6px' }}>{stat.label}</div>
            <div style={{ fontSize: '26px', fontWeight: '800', color: D.text, letterSpacing: '-0.5px' }}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* ── Budget panel ─────────────────────────────────────────── */}
      {budgetTotal != null && (
        <div style={{ backgroundColor: D.surface, border: `1px solid ${budgetOver ? '#FECACA' : D.border}`, borderRadius: '12px', padding: '20px 24px', boxShadow: D.shadow }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.8px', color: D.textMuted }}>
              {t('campaign.budgetPanel.title')}
            </span>
            {budgetOver && (
              <span style={{ fontSize: '11px', fontWeight: '700', color: '#DC2626', backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: '99px', padding: '3px 10px' }}>
                ⚠ {t('campaign.budgetPanel.overBudget')}
              </span>
            )}
          </div>
          <div style={{ height: '8px', backgroundColor: D.surfaceHigh, borderRadius: '99px', overflow: 'hidden', marginBottom: '14px' }}>
            <div style={{ height: '100%', width: `${Math.min(budgetPct, 100)}%`, backgroundColor: budgetOver ? '#EF4444' : budgetPct >= 80 ? '#F59E0B' : '#7C6FF7', borderRadius: '99px', transition: 'width 0.3s' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
            <BudgetStat label={t('campaign.budgetPanel.total')}     value={`€${fmtNum(budgetTotal)}`}          color={D.text} />
            <BudgetStat label={t('campaign.budgetPanel.used')}      value={`€${fmtNum(budgetUsed)}`}           color={budgetOver ? '#DC2626' : D.text} />
            <BudgetStat label={budgetOver ? t('campaign.budgetPanel.exceeded') : t('campaign.budgetPanel.remaining')} value={`€${fmtNum(Math.abs(budgetRemain))}`} color={budgetOver ? '#DC2626' : '#10B981'} />
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
           GUEST LIST (event campaigns only)
         ══════════════════════════════════════════════════════════ */}
      {isEvent && (
        <div style={{ backgroundColor: D.surface, border: `1px solid ${D.border}`, borderRadius: '12px', boxShadow: D.shadow, overflow: 'hidden' }}>

          {/* Header */}
          <div style={{ padding: '16px 20px', borderBottom: `1px solid ${D.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.8px', color: D.textMuted }}>
              Guest List ({guests.length})
            </span>
            {canManage && (
              <button type="button" onClick={() => setShowAddGuest(v => !v)}
                style={{ padding: '6px 14px', borderRadius: '7px', border: `1px solid ${D.accent}`, backgroundColor: showAddGuest ? D.accentFaint : 'transparent', color: D.accent, cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>
                {showAddGuest ? 'Cancel' : '+ Add Guest'}
              </button>
            )}
          </div>

          {/* Add guest — influencer picker */}
          {showAddGuest && (
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${D.border}`, backgroundColor: D.bg }}>
              <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.6px', color: D.textMuted, marginBottom: '10px' }}>
                Select influencer to add as guest
              </div>
              <input
                type="text"
                placeholder="Search influencers…"
                value={infSearch}
                onChange={e => setInfSearch(e.target.value)}
                autoFocus
                style={{ ...input.base, width: '100%', boxSizing: 'border-box', marginBottom: '10px' }}
              />
              <div style={{ maxHeight: '220px', overflowY: 'auto', border: `1px solid ${D.border}`, borderRadius: '9px', backgroundColor: D.surface }}>
                {filteredInf.length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: D.textMuted, fontSize: '12px' }}>No influencers found</div>
                ) : filteredInf.map((inf, idx) => {
                  const alreadyAdded = guests.some(g => g.influencerId === inf.id);
                  return (
                    <Form key={inf.id} method="post" onSubmit={() => { setShowAddGuest(false); setInfSearch(''); }}>
                      <input type="hidden" name="intent" value="addGuest" />
                      <input type="hidden" name="guestInfluencerId" value={inf.id} />
                      <button
                        type="submit"
                        disabled={alreadyAdded}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '10px',
                          width: '100%', padding: '9px 14px', textAlign: 'left',
                          border: 'none', borderBottom: idx < filteredInf.length - 1 ? `1px solid ${D.borderLight}` : 'none',
                          backgroundColor: 'transparent',
                          cursor: alreadyAdded ? 'default' : 'pointer',
                          opacity: alreadyAdded ? 0.4 : 1,
                          transition: 'background-color 0.1s',
                        }}
                        onMouseOver={e => { if (!alreadyAdded) e.currentTarget.style.backgroundColor = D.surfaceHigh; }}
                        onMouseOut={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                      >
                        <div style={{ width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0, background: `linear-gradient(135deg, ${D.accent}, ${D.purple})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '800', color: '#fff' }}>
                          {(inf.handle?.[0] ?? '?').toUpperCase()}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '13px', fontWeight: '600', color: D.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            @{inf.handle}
                          </div>
                          {inf.name && (
                            <div style={{ fontSize: '11px', color: D.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {inf.name}
                            </div>
                          )}
                        </div>
                        {alreadyAdded && (
                          <span style={{ fontSize: '10px', fontWeight: '700', color: D.textMuted, flexShrink: 0 }}>Added</span>
                        )}
                      </button>
                    </Form>
                  );
                })}
              </div>
            </div>
          )}

          {/* Guest table */}
          {guests.length === 0 && !showAddGuest ? (
            <div style={{ padding: '40px', textAlign: 'center', color: D.textMuted, fontSize: '13px' }}>
              No guests yet. Click "+ Add Guest" to get started.
            </div>
          ) : (
            <div>
              {guests.map((guest, gi) => {
                const gMeta     = GUEST_STATUS[guest.status] || GUEST_STATUS.invited;
                const isExpanded = expandedGuest === guest.id;
                const unfulfilledItems = guest.items.filter(i => !i.fulfilled);
                const fulfilledItems   = guest.items.filter(i => i.fulfilled);

                return (
                  <div key={guest.id} style={{ borderTop: gi > 0 ? `1px solid ${D.borderLight}` : 'none' }}>

                    {/* Main guest row */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto auto', gap: '12px', alignItems: 'center', padding: '12px 20px' }}>

                      {/* Name + email */}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: '700', fontSize: '13px', color: D.text }}>{guest.name}</div>
                        <div style={{ fontSize: '11px', color: D.textMuted, marginTop: '1px', display: 'flex', gap: '8px' }}>
                          {guest.email && <span>{guest.email}</span>}
                          {guest.influencer && (
                            <span style={{ color: D.accent }}>@{guest.influencer.handle}</span>
                          )}
                          {guest.seedingId && (
                            <span style={{ color: '#10B981', fontWeight: '600' }}>✓ Seeding created</span>
                          )}
                        </div>
                      </div>

                      {/* Status */}
                      <Form method="post">
                        <input type="hidden" name="intent" value="updateGuestStatus" />
                        <input type="hidden" name="guestId" value={guest.id} />
                        <select name="status" defaultValue={guest.status}
                          onChange={e => e.target.form.requestSubmit()}
                          style={{ padding: '5px 10px', borderRadius: '20px', border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: '700', backgroundColor: gMeta.bg, color: gMeta.text, appearance: 'none', WebkitAppearance: 'none', paddingRight: '22px', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23999'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'calc(100% - 6px) center' }}>
                          <option value="invited">Invited</option>
                          <option value="confirmed">Confirmed</option>
                          <option value="attended">Attended</option>
                        </select>
                      </Form>

                      {/* Items summary */}
                      <button type="button"
                        onClick={() => setExpandedGuest(isExpanded ? null : guest.id)}
                        style={{ padding: '5px 12px', borderRadius: '7px', border: `1px solid ${D.border}`, backgroundColor: isExpanded ? D.surfaceHigh : 'transparent', color: D.textSub, cursor: 'pointer', fontSize: '12px', fontWeight: '600', whiteSpace: 'nowrap' }}>
                        {guest.items.length === 0 ? 'No items' : `${guest.items.length} item${guest.items.length !== 1 ? 's' : ''} · ${fulfilledItems.length} fulfilled`}
                        <span style={{ marginLeft: '5px', opacity: 0.6 }}>{isExpanded ? '▲' : '▼'}</span>
                      </button>

                      {/* Create seeding CTA */}
                      {canCreate && !campaign.archived && (
                        guest.seedingId ? (
                          <span style={{ fontSize: '11px', color: '#10B981', fontWeight: '600' }}>✓ Done</span>
                        ) : (
                          <Link
                            to={`/portal/new?guestId=${guest.id}&campaignId=${campaign.id}`}
                            style={{ padding: '6px 14px', borderRadius: '7px', background: 'linear-gradient(135deg, #7C6FF7 0%, #9C8FFF 100%)', color: '#fff', textDecoration: 'none', fontSize: '12px', fontWeight: '700', whiteSpace: 'nowrap', boxShadow: '0 1px 4px rgba(124,111,247,0.3)' }}>
                            + Create seeding
                          </Link>
                        )
                      )}

                      {/* Remove */}
                      {canManage && (
                        <Form method="post" onSubmit={e => { if (!confirm(`Remove ${guest.name} from guest list?`)) e.preventDefault(); }}>
                          <input type="hidden" name="intent" value="removeGuest" />
                          <input type="hidden" name="guestId" value={guest.id} />
                          <button type="submit" style={{ background: 'none', border: 'none', color: D.textMuted, cursor: 'pointer', fontSize: '18px', lineHeight: 1, padding: '0 4px' }}>×</button>
                        </Form>
                      )}
                    </div>

                    {/* Expanded items panel */}
                    {isExpanded && (
                      <div style={{ margin: '0 20px 14px', padding: '14px 16px', backgroundColor: D.bg, borderRadius: '10px', border: `1px solid ${D.border}` }}>

                        {/* Existing items */}
                        {guest.items.length > 0 && (
                          <div style={{ marginBottom: campaign.products.length > 0 ? '12px' : '0' }}>
                            <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.7px', color: D.textMuted, marginBottom: '8px' }}>
                              Assigned Items
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                              {guest.items.map(item => (
                                <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 10px', backgroundColor: D.surface, borderRadius: '7px', border: `1px solid ${item.fulfilled ? 'rgba(16,185,129,0.2)' : D.borderLight}` }}>
                                  {item.imageUrl && <img src={item.imageUrl} alt="" style={{ width: '24px', height: '24px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} />}
                                  <span style={{ flex: 1, fontSize: '12px', fontWeight: '600', color: D.text }}>{item.productName}</span>
                                  <span style={{ fontSize: '11px', color: D.textMuted }}>× {item.quantity}</span>
                                  {item.fulfilled ? (
                                    <span style={{ fontSize: '11px', fontWeight: '700', color: '#10B981' }}>✓ Fulfilled</span>
                                  ) : (
                                    <Form method="post">
                                      <input type="hidden" name="intent" value="removeGuestItem" />
                                      <input type="hidden" name="itemId" value={item.id} />
                                      <button type="submit" style={{ background: 'none', border: 'none', color: D.textMuted, cursor: 'pointer', fontSize: '15px', lineHeight: 1, padding: '0 2px' }}>×</button>
                                    </Form>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Add item form (only if campaign has products) */}
                        {campaign.products.length > 0 && canManage && (
                          <div>
                            <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.7px', color: D.textMuted, marginBottom: '8px' }}>
                              Assign Item
                            </div>
                            <Form method="post">
                              <input type="hidden" name="intent" value="addGuestItem" />
                              <input type="hidden" name="guestId" value={guest.id} />
                              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <select name="campaignProductId"
                                  style={{ ...input.base, flex: 1, boxSizing: 'border-box' }}>
                                  {campaign.products.map(cp => {
                                    const tier = allocTier(cp.usedUnits, cp.allocatedUnits);
                                    const remaining = cp.remainingUnits;
                                    const label = cp.productName + (cp.allocatedUnits != null ? ` (${remaining} left)` : '');
                                    return (
                                      <option key={cp.id} value={cp.id} disabled={tier === 'full'}>
                                        {label}
                                      </option>
                                    );
                                  })}
                                </select>
                                <input name="quantity" type="number" min="1" max="99" defaultValue="1"
                                  style={{ ...input.base, width: '64px', textAlign: 'center' }} />
                                <button type="submit"
                                  style={{ padding: '8px 16px', borderRadius: '7px', border: 'none', backgroundColor: D.accent, color: '#fff', cursor: 'pointer', fontSize: '12px', fontWeight: '700', whiteSpace: 'nowrap' }}>
                                  Add
                                </button>
                              </div>
                            </Form>
                          </div>
                        )}

                        {campaign.products.length === 0 && (
                          <div style={{ fontSize: '12px', color: D.textMuted, fontStyle: 'italic' }}>
                            Add products to this campaign to assign items to guests.
                          </div>
                        )}

                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Product allocations ───────────────────────────────────── */}
      <div style={{ backgroundColor: D.surface, border: `1px solid ${D.border}`, borderRadius: '12px', boxShadow: D.shadow, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${D.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.8px', color: D.textMuted }}>
            {t('campaign.products.title', { count: campaign.products.length })}
          </span>
          {isEvent && (
            <span style={{ fontSize: '11px', color: D.textMuted }}>
              Includes guest assignments + seedings
            </span>
          )}
          {!isEvent && (
            <span style={{ fontSize: '11px', color: D.textMuted }}>
              {t('campaign.products.allocationNote')}
            </span>
          )}
        </div>

        {campaign.products.length === 0 ? (
          <div style={{ padding: '24px', color: D.textMuted, fontSize: '13px' }}>{t('campaign.products.empty')}</div>
        ) : (
          <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {campaign.products.map(cp => {
              const tier     = allocTier(cp.usedUnits, cp.allocatedUnits);
              const col      = ALLOC[tier];
              const pct      = cp.allocatedUnits ? Math.min(100, (cp.usedUnits / cp.allocatedUnits) * 100) : null;
              const hasAlloc = cp.allocatedUnits != null;

              return (
                <div key={cp.id} style={{
                  display: 'grid', gridTemplateColumns: '36px 1fr auto', gap: '12px', alignItems: 'center',
                  padding: '12px 14px',
                  border: `1px solid ${tier === 'full' ? '#FECACA' : tier === 'warn' ? '#FDE68A' : D.border}`,
                  borderRadius: '10px',
                  backgroundColor: tier === 'full' ? 'rgba(239,68,68,0.04)' : tier === 'warn' ? 'rgba(245,158,11,0.04)' : D.bg,
                }}>
                  <div>
                    {cp.imageUrl
                      ? <img src={cp.imageUrl} alt={cp.productName} style={{ width: '36px', height: '36px', objectFit: 'cover', borderRadius: '7px' }} />
                      : <div style={{ width: '36px', height: '36px', backgroundColor: D.surfaceHigh, borderRadius: '7px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px' }}>📦</div>
                    }
                  </div>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: '700', color: D.text, marginBottom: hasAlloc ? '6px' : '0' }}>{cp.productName}</div>
                    {hasAlloc && (
                      <>
                        <div style={{ height: '4px', backgroundColor: D.border, borderRadius: '99px', overflow: 'hidden', marginBottom: '4px' }}>
                          <div style={{ height: '100%', width: `${pct}%`, backgroundColor: col.bar, borderRadius: '99px', transition: 'width 0.3s' }} />
                        </div>
                        <div style={{ fontSize: '11px', color: D.textMuted }}>
                          {cp.usedUnits} {t('campaign.products.ofUnits', { total: cp.allocatedUnits })} · {' '}
                          <span style={{ fontWeight: '700', color: col.text }}>
                            {tier === 'full' ? t('campaign.products.fullAlert') : `${cp.remainingUnits} ${t('campaign.products.remaining')}`}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {hasAlloc ? (
                      <span style={{ display: 'inline-block', fontSize: '12px', fontWeight: '800', color: col.text, backgroundColor: col.badge, borderRadius: '8px', padding: '5px 12px', letterSpacing: '-0.3px' }}>
                        {cp.usedUnits} / {cp.allocatedUnits}
                      </span>
                    ) : (
                      <span style={{ fontSize: '12px', color: D.textMuted }}>{cp.usedUnits} used</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Status pipeline ───────────────────────────────────────── */}
      {seedings.length > 0 && (
        <div style={{ backgroundColor: D.surface, border: `1px solid ${D.border}`, borderRadius: '12px', padding: '18px 20px', boxShadow: D.shadow }}>
          <div style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.8px', color: D.textMuted, marginBottom: '14px' }}>{t('campaign.pipeline')}</div>
          <div style={{ display: 'flex', height: '6px', borderRadius: '99px', overflow: 'hidden', marginBottom: '14px', backgroundColor: D.surfaceHigh }}>
            {[[D.statusPending.dot, statusCounts.Pending], [D.statusOrdered.dot, statusCounts.Ordered], [D.statusShipped.dot, statusCounts.Shipped], [D.statusDelivered.dot, statusCounts.Delivered], [D.statusPosted.dot, statusCounts.Posted]].map(([color, count], i) =>
              count > 0 ? <div key={i} style={{ width: `${(count / seedings.length) * 100}%`, backgroundColor: color }} /> : null
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {STATUSES.map(s => {
              const m = STATUS_META[s];
              return (
                <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 12px', backgroundColor: m.bg, borderRadius: '20px' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: m.dot }} />
                  <span style={{ fontSize: '11px', fontWeight: '700', color: m.text }}>{s}: {statusCounts[s]}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Seedings table ────────────────────────────────────────── */}
      <div style={{ backgroundColor: D.surface, border: `1px solid ${D.border}`, borderRadius: '12px', boxShadow: D.shadow, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${D.border}` }}>
          <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.8px', color: D.textMuted }}>
            {t('campaign.seedings.title', { count: seedings.length })}
          </span>
        </div>

        {seedings.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: D.textMuted, fontSize: '13px' }}>
            {t('campaign.seedings.empty')}{' '}
            {canCreate && !isEvent && (
              <Link to="/portal/new" style={{ color: D.accent, fontWeight: '700', textDecoration: 'none' }}>{t('campaign.seedings.createFirst')}</Link>
            )}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: D.bg }}>
                {[t('campaign.seedings.table.influencer'), t('campaign.seedings.table.country'), t('campaign.seedings.table.products'), t('campaign.seedings.table.cost'), t('campaign.seedings.table.status'), t('campaign.seedings.table.tracking'), t('campaign.seedings.table.date'), ...(canDelete ? [''] : [])].map(h => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.7px', color: D.textMuted, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {seedings.map(s => (
                <tr key={s.id} style={{ borderTop: `1px solid ${D.borderLight}` }}>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ fontWeight: '700', color: D.text }}>@{s.influencer.handle}</div>
                    <div style={{ fontSize: '11px', color: D.textMuted, marginTop: '1px' }}>{s.influencer.name}</div>
                  </td>
                  <td style={{ padding: '12px 16px', color: D.textSub }}>{s.influencer.country}</td>
                  <td style={{ padding: '12px 16px', color: D.textSub, fontSize: '12px', maxWidth: '180px' }}>
                    {s.products.map(p => p.productName).join(', ')}
                  </td>
                  <td style={{ padding: '12px 16px', fontWeight: '700', color: D.text, whiteSpace: 'nowrap' }}>
                    €{s.totalCost.toFixed(2)}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    {canEdit ? (
                      <Form method="post">
                        <input type="hidden" name="intent" value="updateStatus" />
                        <input type="hidden" name="seedingId" value={s.id} />
                        <select name="status" defaultValue={s.status} onChange={e => e.target.form.requestSubmit()}
                          style={{ padding: '4px 8px', border: 'none', borderRadius: '12px', fontSize: '11px', fontWeight: '700', cursor: 'pointer', backgroundColor: STATUS_META[s.status]?.bg, color: STATUS_META[s.status]?.text }}>
                          {STATUSES.map(st => <option key={st} value={st}>{st}</option>)}
                        </select>
                      </Form>
                    ) : (
                      <StatusPill status={s.status} />
                    )}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    {canEdit ? (
                      <Form method="post">
                        <input type="hidden" name="intent" value="updateTracking" />
                        <input type="hidden" name="seedingId" value={s.id} />
                        <input type="text" name="trackingNumber" defaultValue={s.trackingNumber || ''} placeholder={t('campaign.seedings.addTracking')}
                          onBlur={e => e.target.form.requestSubmit()}
                          style={{ width: '120px', padding: '4px 8px', border: `1px solid ${D.border}`, borderRadius: '6px', fontSize: '12px', color: D.text, backgroundColor: D.bg }} />
                      </Form>
                    ) : (
                      <span style={{ fontSize: '12px', color: D.textSub }}>{s.trackingNumber || '—'}</span>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px', color: D.textMuted, fontSize: '12px', whiteSpace: 'nowrap' }}>
                    {fmtDate(s.createdAt, 'medium')}
                  </td>
                  {canDelete && (
                    <td style={{ padding: '12px 16px' }}>
                      <Form method="post" onSubmit={e => { if (!confirm(t('campaign.seedings.deleteConfirm'))) e.preventDefault(); }}>
                        <input type="hidden" name="intent" value="deleteSeeding" />
                        <input type="hidden" name="seedingId" value={s.id} />
                        <button type="submit" style={{ background: 'none', border: 'none', color: D.textMuted, cursor: 'pointer', fontSize: '18px', lineHeight: 1 }}>×</button>
                      </Form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

    </div>
  );
}
