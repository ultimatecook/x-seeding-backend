import { useState } from 'react';
import { useLoaderData, Form, Link, redirect } from 'react-router';
import prisma from '../db.server';
import { requirePortalUser } from '../utils/portal-auth.server';
import { can, requirePermission } from '../utils/portal-permissions';
import { audit } from '../utils/audit.server.js';
import { fmtDate, fmtNum } from '../theme';
import { D } from '../utils/portal-theme';
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

// ── Allocation colours ────────────────────────────────────────────────────────
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
    },
  });
  if (!campaign || campaign.shop !== shop) throw new Response('Not Found', { status: 404 });

  // Compute per-product allocation data
  const usedUnits = {};
  for (const s of campaign.seedings) {
    for (const sp of s.products) {
      usedUnits[sp.productId] = (usedUnits[sp.productId] || 0) + 1;
    }
  }
  const products = campaign.products.map(cp => ({
    ...cp,
    usedUnits:       usedUnits[cp.productId] || 0,
    remainingUnits:  cp.allocatedUnits != null ? Math.max(0, cp.allocatedUnits - (usedUnits[cp.productId] || 0)) : null,
  }));

  const budgetUsed = campaign.seedings.reduce((s, x) => s + (x.totalCost || 0), 0);

  return {
    campaign: { ...campaign, products, budgetUsed },
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

  if (intent === 'updateStatus') {
    const id     = parseInt(formData.get('seedingId'));
    const status = formData.get('status');
    if (!STATUSES.includes(status)) return null;
    await prisma.seeding.update({ where: { id }, data: { status } });
    await audit({ shop, portalUser, action: 'updated_status', entityType: 'seeding', entityId: id, detail: `Status → ${status}` });
  }

  if (intent === 'updateTracking') {
    const id             = parseInt(formData.get('seedingId'));
    const trackingNumber = String(formData.get('trackingNumber') || '').slice(0, 200).trim() || null;
    await prisma.seeding.update({ where: { id }, data: { trackingNumber } });
    await audit({ shop, portalUser, action: 'updated_tracking', entityType: 'seeding', entityId: id, detail: `Tracking → ${trackingNumber ?? 'cleared'}` });
  }

  if (intent === 'deleteSeeding') {
    requirePermission(portalUser.role, 'deleteSeeding');
    const id = parseInt(formData.get('seedingId'));
    const seeding = await prisma.seeding.findUnique({ where: { id }, include: { influencer: true } });
    await releaseDiscountCodes(shop, id);
    await prisma.seeding.delete({ where: { id } });
    await audit({ shop, portalUser, action: 'deleted_seeding', entityType: 'seeding', entityId: id, detail: `Deleted seeding for ${seeding?.influencer?.handle ?? id}` });
  }

  if (intent === 'archive' || intent === 'unarchive') {
    requirePermission(portalUser.role, 'editCampaign');
    const id       = parseInt(params.id);
    const archived = intent === 'archive';
    const existing = await prisma.campaign.findUnique({ where: { id }, select: { shop: true, title: true } });
    if (!existing || existing.shop !== shop) throw new Response('Not Found', { status: 404 });
    await prisma.campaign.update({ where: { id }, data: { archived } });
    await audit({ shop, portalUser, action: `${intent}d_campaign`, entityType: 'campaign', entityId: id, detail: `${archived ? 'Archived' : 'Unarchived'} campaign "${existing.title}"` });
    if (archived) throw redirect('/portal/campaigns');
  }

  if (intent === 'deleteCampaign') {
    requirePermission(portalUser.role, 'deleteCampaign');
    const id       = parseInt(params.id);
    const existing = await prisma.campaign.findUnique({ where: { id }, select: { shop: true, title: true } });
    if (!existing || existing.shop !== shop) throw new Response('Not Found', { status: 404 });
    await prisma.campaign.delete({ where: { id } });
    await audit({ shop, portalUser, action: 'deleted_campaign', entityType: 'campaign', entityId: id, detail: `Deleted campaign "${existing.title}"` });
    throw redirect('/portal/campaigns');
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

// ── Component ─────────────────────────────────────────────────────────────────
export default function PortalCampaignDetail() {
  const { campaign, role, canDelete: canDeleteCampaign } = useLoaderData();
  const { t } = useT();
  const canEdit   = can.updateSeeding(role);
  const canDelete = can.deleteSeeding(role);
  const canCreate = can.createSeeding(role);

  const seedings     = campaign.seedings;
  const budgetUsed   = campaign.budgetUsed;
  const budgetTotal  = campaign.budget;
  const budgetOver   = budgetTotal != null && budgetUsed > budgetTotal;
  const budgetPct    = budgetTotal ? Math.min(100, (budgetUsed / budgetTotal) * 100) : null;
  const budgetRemain = budgetTotal != null ? budgetTotal - budgetUsed : null;

  const statusCounts = STATUSES.reduce((acc, s) => { acc[s] = seedings.filter(sd => sd.status === s).length; return acc; }, {});

  return (
    <div style={{ display: 'grid', gap: '20px' }}>

      {/* Back */}
      <Link to="/portal/campaigns" style={{ fontSize: '13px', color: D.textMuted, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
        {t('campaign.backLink')}
      </Link>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <h2 style={{ margin: 0, fontSize: '22px', fontWeight: '800', color: D.text, letterSpacing: '-0.3px' }}>
              {campaign.title}
            </h2>
            {campaign.archived && (
              <span style={{ fontSize: '11px', fontWeight: '700', color: D.textMuted, backgroundColor: D.surfaceHigh, border: `1px solid ${D.border}`, borderRadius: '20px', padding: '2px 10px' }}>
                {t('campaign.archived')}
              </span>
            )}
          </div>
          <div style={{ fontSize: '13px', color: D.textSub, display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
            <span>{t('campaign.created', { date: fmtDate(campaign.createdAt, 'medium') })}</span>
            {campaign.startDate && (
              <span>{fmtDate(campaign.startDate, 'short')} – {campaign.endDate ? fmtDate(campaign.endDate, 'short') : '…'}</span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {canDeleteCampaign && (
            <>
              <Form method="post">
                <input type="hidden" name="intent" value={campaign.archived ? 'unarchive' : 'archive'} />
                <button type="submit"
                  style={{ padding: '8px 14px', borderRadius: '8px', border: `1px solid ${D.border}`, backgroundColor: 'transparent', color: D.textSub, cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
                  {campaign.archived ? t('campaign.restore') : t('campaign.archive')}
                </button>
              </Form>
              {campaign.archived && (
                <Form method="post" onSubmit={e => { if (!confirm(`Permanently delete "${campaign.title}"? This cannot be undone.`)) e.preventDefault(); }}>
                  <input type="hidden" name="intent" value="deleteCampaign" />
                  <button type="submit"
                    style={{ padding: '8px 14px', borderRadius: '8px', border: `1px solid ${D.errorText}`, backgroundColor: 'transparent', color: D.errorText, cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
                    {t('campaign.delete')}
                  </button>
                </Form>
              )}
            </>
          )}
          {canCreate && !campaign.archived && (
            <Link to="/portal/new" style={{
              padding: '8px 18px',
              background: 'linear-gradient(135deg, #7C6FF7 0%, #9C8FFF 100%)',
              color: '#fff', borderRadius: '8px', textDecoration: 'none',
              fontSize: '13px', fontWeight: '700',
              boxShadow: '0 2px 6px rgba(124,111,247,0.35)',
            }}>
              {t('campaign.addSeeding')}
            </Link>
          )}
        </div>
      </div>

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
        {[
          { label: t('campaign.kpi.seedings'),    value: seedings.length },
          { label: t('campaign.kpi.retailValue'), value: `€${fmtNum(budgetUsed)}` },
          { label: t('campaign.kpi.products'),    value: campaign.products.length },
          { label: t('campaign.kpi.posted'),      value: statusCounts['Posted'] },
        ].map(stat => (
          <div key={stat.label} style={{ backgroundColor: D.surface, border: `1px solid ${D.border}`, borderRadius: '12px', padding: '18px 20px', boxShadow: D.shadow }}>
            <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.8px', color: D.textMuted, marginBottom: '6px' }}>{stat.label}</div>
            <div style={{ fontSize: '26px', fontWeight: '800', color: D.text, letterSpacing: '-0.5px' }}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* ── Budget panel ──────────────────────────────────────────── */}
      {budgetTotal != null && (
        <div style={{
          backgroundColor: D.surface, border: `1px solid ${budgetOver ? '#FECACA' : D.border}`,
          borderRadius: '12px', padding: '20px 24px', boxShadow: D.shadow,
        }}>
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

          {/* Progress bar */}
          <div style={{ height: '8px', backgroundColor: D.surfaceHigh, borderRadius: '99px', overflow: 'hidden', marginBottom: '14px' }}>
            <div style={{
              height: '100%',
              width: `${Math.min(budgetPct, 100)}%`,
              backgroundColor: budgetOver ? '#EF4444' : budgetPct >= 80 ? '#F59E0B' : '#7C6FF7',
              borderRadius: '99px', transition: 'width 0.3s',
            }} />
          </div>

          {/* Budget figures */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
            <BudgetStat label={t('campaign.budgetPanel.total')}     value={`€${fmtNum(budgetTotal)}`}           color={D.text} />
            <BudgetStat label={t('campaign.budgetPanel.used')}      value={`€${fmtNum(budgetUsed)}`}            color={budgetOver ? '#DC2626' : D.text} />
            <BudgetStat
              label={budgetOver ? t('campaign.budgetPanel.exceeded') : t('campaign.budgetPanel.remaining')}
              value={`€${fmtNum(Math.abs(budgetRemain))}`}
              color={budgetOver ? '#DC2626' : '#10B981'}
            />
          </div>
        </div>
      )}

      {/* ── Status pipeline ───────────────────────────────────────── */}
      <div style={{ backgroundColor: D.surface, border: `1px solid ${D.border}`, borderRadius: '12px', padding: '18px 20px', boxShadow: D.shadow }}>
        <div style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.8px', color: D.textMuted, marginBottom: '14px' }}>{t('campaign.pipeline')}</div>
        {seedings.length > 0 && (
          <div style={{ display: 'flex', height: '6px', borderRadius: '99px', overflow: 'hidden', marginBottom: '14px', backgroundColor: D.surfaceHigh }}>
            {[[D.statusPending.dot, statusCounts.Pending], [D.statusOrdered.dot, statusCounts.Ordered], [D.statusShipped.dot, statusCounts.Shipped], [D.statusDelivered.dot, statusCounts.Delivered], [D.statusPosted.dot, statusCounts.Posted]].map(([color, count], i) =>
              count > 0 ? <div key={i} style={{ width: `${(count / seedings.length) * 100}%`, backgroundColor: color }} /> : null
            )}
          </div>
        )}
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

      {/* ── Product allocations ───────────────────────────────────── */}
      <div style={{ backgroundColor: D.surface, border: `1px solid ${D.border}`, borderRadius: '12px', boxShadow: D.shadow, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${D.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.8px', color: D.textMuted }}>
            {t('campaign.products.title', { count: campaign.products.length })}
          </span>
          <span style={{ fontSize: '11px', color: D.textMuted }}>
            {t('campaign.products.allocationNote')}
          </span>
        </div>

        {campaign.products.length === 0 ? (
          <div style={{ padding: '24px', color: D.textMuted, fontSize: '13px' }}>{t('campaign.products.empty')}</div>
        ) : (
          <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {campaign.products.map(cp => {
              const tier      = allocTier(cp.usedUnits, cp.allocatedUnits);
              const col       = ALLOC[tier];
              const pct       = cp.allocatedUnits ? Math.min(100, (cp.usedUnits / cp.allocatedUnits) * 100) : null;
              const hasAlloc  = cp.allocatedUnits != null;

              return (
                <div key={cp.id} style={{
                  display: 'grid',
                  gridTemplateColumns: '36px 1fr auto',
                  gap: '12px', alignItems: 'center',
                  padding: '12px 14px',
                  border: `1px solid ${tier === 'full' ? '#FECACA' : tier === 'warn' ? '#FDE68A' : D.border}`,
                  borderRadius: '10px',
                  backgroundColor: tier === 'full' ? 'rgba(239,68,68,0.04)' : tier === 'warn' ? 'rgba(245,158,11,0.04)' : D.bg,
                }}>
                  {/* Thumbnail */}
                  <div>
                    {cp.imageUrl
                      ? <img src={cp.imageUrl} alt={cp.productName} style={{ width: '36px', height: '36px', objectFit: 'cover', borderRadius: '7px' }} />
                      : <div style={{ width: '36px', height: '36px', backgroundColor: D.surfaceHigh, borderRadius: '7px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px' }}>📦</div>
                    }
                  </div>

                  {/* Name + bar */}
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: '700', color: D.text, marginBottom: hasAlloc ? '6px' : '0' }}>
                      {cp.productName}
                    </div>
                    {hasAlloc && (
                      <>
                        <div style={{ height: '4px', backgroundColor: D.border, borderRadius: '99px', overflow: 'hidden', marginBottom: '4px' }}>
                          <div style={{ height: '100%', width: `${pct}%`, backgroundColor: col.bar, borderRadius: '99px', transition: 'width 0.3s' }} />
                        </div>
                        <div style={{ fontSize: '11px', color: D.textMuted }}>
                          {cp.usedUnits} {t('campaign.products.ofUnits', { total: cp.allocatedUnits })}
                          {' · '}
                          <span style={{ fontWeight: '700', color: col.text }}>
                            {tier === 'full'
                              ? t('campaign.products.fullAlert')
                              : `${cp.remainingUnits} ${t('campaign.products.remaining')}`
                            }
                          </span>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Allocation badge */}
                  <div style={{ textAlign: 'right' }}>
                    {hasAlloc ? (
                      <span style={{ display: 'inline-block', fontSize: '12px', fontWeight: '800', color: col.text, backgroundColor: col.badge, borderRadius: '8px', padding: '5px 12px', letterSpacing: '-0.3px' }}>
                        {cp.usedUnits} / {cp.allocatedUnits}
                      </span>
                    ) : (
                      <span style={{ fontSize: '12px', color: D.textMuted, fontWeight: '500' }}>
                        {cp.usedUnits} {t('campaign.products.seeded', { count: cp.usedUnits })}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

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
            {canCreate && <Link to="/portal/new" style={{ color: D.accent, fontWeight: '700', textDecoration: 'none' }}>{t('campaign.seedings.createFirst')}</Link>}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: D.bg }}>
                {[
                  t('campaign.seedings.table.influencer'),
                  t('campaign.seedings.table.country'),
                  t('campaign.seedings.table.products'),
                  t('campaign.seedings.table.cost'),
                  t('campaign.seedings.table.status'),
                  t('campaign.seedings.table.tracking'),
                  t('campaign.seedings.table.date'),
                  ...(canDelete ? [''] : []),
                ].map(h => (
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

function BudgetStat({ label, value, color }) {
  return (
    <div style={{ padding: '12px 16px', backgroundColor: D.bg, borderRadius: '8px', border: `1px solid ${D.border}` }}>
      <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.7px', color: D.textMuted, marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: '20px', fontWeight: '800', color, letterSpacing: '-0.5px' }}>{value}</div>
    </div>
  );
}
