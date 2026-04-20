import { useState } from 'react';
import { useLoaderData, Link, Form, redirect, useActionData } from 'react-router';
import prisma from '../db.server';
import { requirePortalUser } from '../utils/portal-auth.server';
import { can, requirePermission } from '../utils/portal-permissions';
import { audit } from '../utils/audit.server.js';
import { fmtDate, fmtNum } from '../theme';
import { D, Pbtn as btn, Pinput as input } from '../utils/portal-theme';
import { useT } from '../utils/i18n';

// ── Loader ────────────────────────────────────────────────────────────────────
export async function loader({ request }) {
  const { shop, portalUser } = await requirePortalUser(request);
  requirePermission(portalUser.role, 'viewCampaigns');

  const url        = new URL(request.url);
  const showArchived = url.searchParams.get('archived') === '1';

  const campaigns = await prisma.campaign.findMany({
    where:   { shop, archived: showArchived },
    include: { products: true, _count: { select: { seedings: true } } },
    orderBy: { createdAt: 'desc' },
  });

  // Compute used units per product per campaign for allocation display
  const campaignIds = campaigns.map(c => c.id);
  let usedUnitsMap = {}; // campaignId → productId → count
  let budgetUsedMap = {}; // campaignId → total spend
  if (campaignIds.length > 0) {
    const seedingProducts = await prisma.seedingProduct.findMany({
      where:  { seeding: { campaignId: { in: campaignIds } } },
      select: { productId: true, seeding: { select: { campaignId: true, totalCost: true } } },
    });
    for (const sp of seedingProducts) {
      const cid = sp.seeding.campaignId;
      if (cid == null) continue;
      if (!usedUnitsMap[cid])   usedUnitsMap[cid]   = {};
      if (!budgetUsedMap[cid])  budgetUsedMap[cid]  = 0;
      usedUnitsMap[cid][sp.productId] = (usedUnitsMap[cid][sp.productId] || 0) + 1;
    }
    // budget used per campaign
    const seedings = await prisma.seeding.findMany({
      where:  { campaignId: { in: campaignIds } },
      select: { campaignId: true, totalCost: true },
    });
    for (const s of seedings) {
      if (s.campaignId == null) continue;
      budgetUsedMap[s.campaignId] = (budgetUsedMap[s.campaignId] || 0) + (s.totalCost || 0);
    }
  }

  const campaignsWithData = campaigns.map(c => ({
    ...c,
    budgetUsed: budgetUsedMap[c.id] || 0,
    products: c.products.map(cp => ({
      ...cp,
      usedUnits: usedUnitsMap[c.id]?.[cp.productId] || 0,
    })),
  }));

  // Fetch Shopify products for the product picker
  let shopifyProducts = [];
  try {
    let session = await prisma.session.findFirst({ where: { shop, isOnline: false, expires: null } });
    if (!session) session = await prisma.session.findFirst({ where: { shop, isOnline: false }, orderBy: { expires: 'desc' } });
    if (!session) session = await prisma.session.findFirst({ where: { shop }, orderBy: { expires: 'desc' } });

    if (session?.accessToken) {
      const res  = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': session.accessToken },
        body: JSON.stringify({ query: `query {
          products(first: 100, sortKey: TITLE, query: "status:active") { edges { node {
            id title featuredImage { url }
            variants(first: 1) { edges { node { price } } }
          } } }
        }` }),
      });
      const body = await res.json();
      shopifyProducts = (body?.data?.products?.edges ?? []).map(e => ({
        id:    e.node.id,
        name:  e.node.title,
        image: e.node.featuredImage?.url ?? null,
        price: parseFloat(e.node.variants.edges[0]?.node?.price || 0),
      }));
    }
  } catch (e) {
    console.error('Portal campaigns: failed to fetch products', e.message);
  }

  return { campaigns: campaignsWithData, shopifyProducts, showArchived, canCreate: can.createCampaign(portalUser.role), canDelete: can.deleteCampaign(portalUser.role) };
}

// ── Action ────────────────────────────────────────────────────────────────────
export async function action({ request }) {
  const { shop, portalUser } = await requirePortalUser(request);

  const formData = await request.formData();
  const intent   = formData.get('intent');

  if (intent === 'archive' || intent === 'unarchive') {
    requirePermission(portalUser.role, 'editCampaign');
    const id       = parseInt(formData.get('campaignId'));
    const archived = intent === 'archive';
    const existing = await prisma.campaign.findUnique({ where: { id }, select: { shop: true, title: true } });
    if (!existing || existing.shop !== shop) throw new Response('Not Found', { status: 404 });
    await prisma.campaign.update({ where: { id }, data: { archived } });
    await audit({ shop, portalUser, action: `${intent}d_campaign`, entityType: 'campaign', entityId: id, detail: `${archived ? 'Archived' : 'Unarchived'} campaign "${existing.title}"` });
    return null;
  }

  if (intent === 'delete') {
    requirePermission(portalUser.role, 'deleteCampaign');
    const id       = parseInt(formData.get('campaignId'));
    const existing = await prisma.campaign.findUnique({ where: { id }, select: { shop: true, title: true } });
    if (!existing || existing.shop !== shop) throw new Response('Not Found', { status: 404 });
    await prisma.campaign.delete({ where: { id } });
    await audit({ shop, portalUser, action: 'deleted_campaign', entityType: 'campaign', entityId: id, detail: `Deleted campaign "${existing.title}"` });
    return null;
  }

  // ── Create ───────────────────────────────────────────────────────────────
  requirePermission(portalUser.role, 'createCampaign');

  const title            = String(formData.get('title') || '').trim();
  const type             = formData.get('campaignType') === 'event' ? 'event' : 'seeding';
  const budgetRaw        = formData.get('budget');
  const budget           = budgetRaw ? parseFloat(budgetRaw) : null;
  const startDateRaw     = formData.get('startDate');
  const endDateRaw       = formData.get('endDate');
  const startDate        = startDateRaw ? new Date(startDateRaw) : null;
  const endDate          = endDateRaw   ? new Date(endDateRaw)   : null;
  const eventDateRaw     = formData.get('eventDate');
  const eventDate        = eventDateRaw ? new Date(eventDateRaw) : null;
  const eventLocation    = formData.get('eventLocation') ? String(formData.get('eventLocation')).trim() : null;

  const productIds       = formData.getAll('productIds');
  const productNames     = formData.getAll('productNames');
  const productImages    = formData.getAll('productImages');
  const productAllocs    = formData.getAll('productAllocs'); // allocatedUnits per product

  if (!title) return { error: 'Campaign title is required.' };

  const campaign = await prisma.campaign.create({
    data: {
      shop, title, type, budget, startDate, endDate, eventDate, eventLocation,
      products: {
        create: productIds.map((productId, i) => ({
          productId,
          productName:    productNames[i]  || '',
          imageUrl:       productImages[i] || null,
          allocatedUnits: productAllocs[i] ? parseInt(productAllocs[i]) : null,
        })),
      },
    },
  });

  await audit({ shop, portalUser, action: 'created_campaign', entityType: 'campaign', entityId: campaign.id, detail: `Created campaign "${title}" with ${productIds.length} product(s)` });
  throw redirect(`/portal/campaigns/${campaign.id}`);
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function PortalCampaigns() {
  const { campaigns, shopifyProducts, showArchived, canCreate, canDelete } = useLoaderData();
  const actionData = useActionData();
  const { t } = useT();

  const [showForm,      setShowForm]      = useState(false);
  const [campaignType,  setCampaignType]  = useState('seeding'); // 'seeding' | 'event'
  const [productSearch, setProductSearch] = useState('');
  // selectedProds: array of { id, name, image, allocatedUnits: number|'' }
  const [selectedProds, setSelectedProds] = useState([]);

  const filteredProducts = shopifyProducts.filter(p =>
    !productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase())
  );

  function toggleProduct(prod) {
    setSelectedProds(prev => {
      const exists = prev.find(p => p.id === prod.id);
      if (exists) return prev.filter(p => p.id !== prod.id);
      return [...prev, { id: prod.id, name: prod.name, image: prod.image, allocatedUnits: '' }];
    });
  }

  function setAlloc(prodId, val) {
    setSelectedProds(prev => prev.map(p => p.id === prodId ? { ...p, allocatedUnits: val } : p));
  }

  function handleCancel() {
    setShowForm(false);
    setCampaignType('seeding');
    setSelectedProds([]);
    setProductSearch('');
  }

  const ALLOC_COLORS = {
    ok:   { bg: 'rgba(16,185,129,0.08)', text: '#10B981', bar: '#10B981' },
    warn: { bg: 'rgba(245,158,11,0.10)', text: '#D97706', bar: '#F59E0B' },
    over: { bg: 'rgba(239,68,68,0.08)',  text: '#DC2626', bar: '#EF4444' },
  };

  function allocState(used, allocated) {
    if (!allocated) return null;
    const pct = (used / allocated) * 100;
    if (pct >= 100) return 'over';
    if (pct >= 80)  return 'warn';
    return 'ok';
  }

  return (
    <div style={{ display: 'grid', gap: '20px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: D.text, letterSpacing: '-0.3px' }}>
            {showArchived ? t('campaigns.archived') : t('campaigns.title')}{' '}
            {campaigns.length > 0 && <span style={{ fontSize: '14px', fontWeight: '600', color: D.textMuted }}>({campaigns.length})</span>}
          </h2>
          <Link to={showArchived ? '/portal/campaigns' : '/portal/campaigns?archived=1'}
            style={{ fontSize: '12px', color: D.textMuted, textDecoration: 'none', padding: '4px 10px', border: `1px solid ${D.border}`, borderRadius: '20px', fontWeight: '600' }}>
            {showArchived ? t('campaigns.active') : t('campaigns.archivedLink')}
          </Link>
        </div>
        {canCreate && !showArchived && (
          <button type="button" onClick={() => showForm ? handleCancel() : setShowForm(true)}
            style={{ ...btn.primary, padding: '9px 18px', fontSize: '13px' }}>
            {showForm ? t('common.cancel') : t('campaigns.newCampaign')}
          </button>
        )}
      </div>

      {/* ── Create form ─────────────────────────────────────────── */}
      {showForm && canCreate && (
        <div style={{ backgroundColor: D.surface, border: `1px solid ${D.accent}`, borderRadius: '12px', padding: '24px', boxShadow: D.shadow }}>
          <Form method="post" onSubmit={handleCancel}>
            {/* Hidden fields for selected products */}
            {selectedProds.map(p => (
              <span key={p.id}>
                <input type="hidden" name="productIds"    value={p.id} />
                <input type="hidden" name="productNames"  value={p.name} />
                <input type="hidden" name="productImages" value={p.image ?? ''} />
                <input type="hidden" name="productAllocs" value={p.allocatedUnits ?? ''} />
              </span>
            ))}
            <input type="hidden" name="campaignType" value={campaignType} />

            {/* Type toggle */}
            <div style={{ marginBottom: '20px' }}>
              <label style={labelStyle}>{t('campaigns.form.type')}</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {[
                  { value: 'seeding', label: t('campaigns.form.typeSeeding'), icon: '📦' },
                  { value: 'event',   label: t('campaigns.form.typeEvent'),   icon: '🎯' },
                ].map(opt => (
                  <button key={opt.value} type="button"
                    onClick={() => setCampaignType(opt.value)}
                    style={{
                      padding: '9px 20px', borderRadius: '8px', cursor: 'pointer',
                      fontSize: '13px', fontWeight: '600',
                      border: `2px solid ${campaignType === opt.value ? D.accent : D.border}`,
                      backgroundColor: campaignType === opt.value ? D.accentFaint : D.surface,
                      color: campaignType === opt.value ? D.accent : D.textSub,
                      transition: 'all 0.12s',
                    }}>
                    {opt.icon} {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Title + Budget */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
              <div>
                <label style={labelStyle}>{t('campaigns.form.title')}</label>
                <input name="title" required placeholder={t('campaigns.form.titlePlaceholder')} autoFocus
                  style={{ ...input.base, width: '100%', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={labelStyle}>{t('campaigns.form.budget')}</label>
                <input name="budget" type="number" min="0" step="0.01" placeholder={t('campaigns.form.budgetPlaceholder')}
                  style={{ ...input.base, width: '100%', boxSizing: 'border-box' }} />
              </div>
            </div>

            {/* Event fields (event type only) */}
            {campaignType === 'event' ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div>
                  <label style={labelStyle}>{t('campaigns.form.eventDate')}</label>
                  <input name="eventDate" type="date"
                    style={{ ...input.base, width: '100%', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={labelStyle}>{t('campaigns.form.eventLocation')}</label>
                  <input name="eventLocation" type="text" placeholder={t('campaigns.form.eventLocationPlaceholder')}
                    style={{ ...input.base, width: '100%', boxSizing: 'border-box' }} />
                </div>
              </div>
            ) : (
              /* Seeding dates */
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div>
                  <label style={labelStyle}>{t('campaigns.form.startDate')}</label>
                  <input name="startDate" type="date"
                    style={{ ...input.base, width: '100%', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={labelStyle}>{t('campaigns.form.endDate')}</label>
                  <input name="endDate" type="date"
                    style={{ ...input.base, width: '100%', boxSizing: 'border-box' }} />
                </div>
              </div>
            )}

            {/* Product picker */}
            <div style={{ marginBottom: '20px' }}>
              <label style={labelStyle}>
                {t('campaigns.form.products')} {selectedProds.length > 0 && <span style={{ color: D.accent }}>({t('campaigns.form.productsSelected', { count: selectedProds.length })})</span>}
              </label>
              <input
                type="text" placeholder={t('campaigns.form.searchProducts')} value={productSearch}
                onChange={e => setProductSearch(e.target.value)}
                style={{ ...input.base, width: '100%', boxSizing: 'border-box', marginBottom: '10px' }}
              />
              {shopifyProducts.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: D.textMuted, fontSize: '13px', border: `1px dashed ${D.border}`, borderRadius: '8px' }}>
                  {t('campaigns.form.noProducts')}
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '8px', maxHeight: '280px', overflowY: 'auto', padding: '2px' }}>
                  {filteredProducts.map(prod => {
                    const selected = selectedProds.some(p => p.id === prod.id);
                    return (
                      <div key={prod.id}
                        onClick={() => toggleProduct(prod)}
                        style={{
                          border: `2px solid ${selected ? D.accent : D.border}`,
                          borderRadius: '8px', overflow: 'hidden', cursor: 'pointer',
                          backgroundColor: selected ? D.accentFaint : D.surface,
                          transition: 'all 0.12s', position: 'relative',
                        }}>
                        {selected && (
                          <div style={{ position: 'absolute', top: '5px', right: '5px', width: '18px', height: '18px', borderRadius: '50%', backgroundColor: D.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '900', color: '#fff', zIndex: 1 }}>
                            ✓
                          </div>
                        )}
                        {prod.image
                          ? <img src={prod.image} alt={prod.name} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }} />
                          : <div style={{ width: '100%', aspectRatio: '1', backgroundColor: D.surfaceHigh, display: 'flex', alignItems: 'center', justifyContent: 'center', color: D.textMuted, fontSize: '22px' }}>📦</div>
                        }
                        <div style={{ padding: '5px 7px' }}>
                          <div style={{ fontSize: '11px', fontWeight: '700', color: D.text, lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                            {prod.name}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Per-product allocation inputs */}
            {selectedProds.length > 0 && (
              <div style={{ marginBottom: '20px' }}>
                <label style={labelStyle}>{t('campaigns.form.allocations')}</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {selectedProds.map(p => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', backgroundColor: D.bg, borderRadius: '8px', border: `1px solid ${D.border}` }}>
                      {p.image && <img src={p.image} alt={p.name} style={{ width: '30px', height: '30px', objectFit: 'cover', borderRadius: '5px', flexShrink: 0 }} />}
                      <span style={{ flex: 1, fontSize: '13px', fontWeight: '600', color: D.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.name}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                        <label style={{ fontSize: '11px', color: D.textMuted, whiteSpace: 'nowrap' }}>{t('campaigns.form.maxUnits')}</label>
                        <input
                          type="number" min="1" step="1"
                          placeholder="—"
                          value={p.allocatedUnits}
                          onChange={e => setAlloc(p.id, e.target.value)}
                          onClick={e => e.stopPropagation()}
                          style={{ ...input.base, width: '72px', textAlign: 'center', padding: '5px 8px' }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: '11px', color: D.textMuted, marginTop: '6px' }}>
                  {t('campaigns.form.allocationsHint')}
                </div>
              </div>
            )}

            {actionData?.error && (
              <div style={{ padding: '10px 14px', backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px', color: '#DC2626', fontSize: '13px', marginBottom: '12px' }}>
                {actionData.error}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', paddingTop: '4px', borderTop: `1px solid ${D.border}` }}>
              <button type="button" onClick={handleCancel}
                style={{ padding: '9px 18px', borderRadius: '8px', border: `1px solid ${D.border}`, backgroundColor: 'transparent', color: D.textSub, cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>
                {t('campaigns.form.cancel')}
              </button>
              <button type="submit"
                style={{ ...btn.primary, padding: '9px 24px', fontSize: '13px' }}>
                {t('campaigns.form.create')}
              </button>
            </div>
          </Form>
        </div>
      )}

      {/* ── Campaign list ──────────────────────────────────────── */}
      {campaigns.length === 0 && !showForm ? (
        <div style={{ textAlign: 'center', padding: '60px', border: `2px dashed ${D.border}`, borderRadius: '12px', color: D.textMuted }}>
          <p style={{ margin: 0, fontSize: '15px', color: D.textSub }}>{t('campaigns.empty')}</p>
          {canCreate && <p style={{ margin: '6px 0 0', fontSize: '13px' }}>{t('campaigns.emptyAction')}</p>}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '12px' }}>
          {campaigns.map(c => {
            const budgetPct   = c.budget ? Math.min(100, (c.budgetUsed / c.budget) * 100) : null;
            const budgetOver  = c.budget && c.budgetUsed > c.budget;
            const hasAllocs   = c.products.some(p => p.allocatedUnits != null);
            const allocFull   = hasAllocs && c.products.some(p => p.allocatedUnits != null && p.usedUnits >= p.allocatedUnits);

            return (
              <div key={c.id} style={{
                backgroundColor: D.surface, border: `1px solid ${D.border}`,
                borderRadius: '12px', padding: '18px 20px', boxShadow: D.shadow,
                opacity: c.archived ? 0.65 : 1,
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'start', gap: '16px' }}>
                  <Link to={`/portal/campaigns/${c.id}`} style={{ textDecoration: 'none', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '15px', fontWeight: '800', color: D.text }}>{c.title}</span>
                      {c.type === 'event' && (
                        <span style={{ fontSize: '10px', fontWeight: '700', color: '#7C3AED', backgroundColor: 'rgba(124,58,237,0.1)', borderRadius: '99px', padding: '2px 8px' }}>🎯 EVENT</span>
                      )}
                      {allocFull && <span style={{ fontSize: '10px', fontWeight: '700', color: '#DC2626', backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: '99px', padding: '2px 8px' }}>FULL</span>}
                      {budgetOver && <span style={{ fontSize: '10px', fontWeight: '700', color: '#D97706', backgroundColor: 'rgba(245,158,11,0.1)', borderRadius: '99px', padding: '2px 8px' }}>OVER BUDGET</span>}
                    </div>
                    <div style={{ fontSize: '12px', color: D.textSub, display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                      <span>{c._count.seedings} {c._count.seedings === 1 ? t('campaigns.seedings_one') : t('campaigns.seedings_other')}</span>
                      <span>{c.products.length} {c.products.length === 1 ? t('campaigns.products_one') : t('campaigns.products_other')}</span>
                      {c.budget != null && (
                        <span style={{ color: budgetOver ? '#DC2626' : D.accent, fontWeight: '700' }}>
                          €{fmtNum(c.budgetUsed)} / €{fmtNum(c.budget)}
                        </span>
                      )}
                      {c.type === 'event' && c.eventDate && (
                        <span>📅 {fmtDate(c.eventDate, 'short')}{c.eventLocation ? ` · ${c.eventLocation}` : ''}</span>
                      )}
                      {c.type !== 'event' && c.startDate && <span>{fmtDate(c.startDate, 'short')} – {c.endDate ? fmtDate(c.endDate, 'short') : '…'}</span>}
                      {c.type !== 'event' && !c.startDate && <span>{fmtDate(c.createdAt, 'medium')}</span>}
                    </div>

                    {/* Budget bar */}
                    {budgetPct !== null && (
                      <div style={{ height: '3px', backgroundColor: D.border, borderRadius: '99px', marginTop: '8px', overflow: 'hidden', maxWidth: '240px' }}>
                        <div style={{ height: '100%', width: `${Math.min(budgetPct, 100)}%`, backgroundColor: budgetOver ? '#EF4444' : budgetPct >= 80 ? '#F59E0B' : D.accent, borderRadius: '99px' }} />
                      </div>
                    )}

                    {/* Product chips with allocation */}
                    {c.products.length > 0 && (
                      <div style={{ marginTop: '10px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {c.products.map(p => {
                          const state = allocState(p.usedUnits, p.allocatedUnits);
                          const col   = state ? ALLOC_COLORS[state] : null;
                          return (
                            <div key={p.id} style={{
                              display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px',
                              backgroundColor: col ? col.bg : D.bg,
                              border: `1px solid ${col ? col.text + '40' : D.borderLight}`,
                              borderRadius: '6px', padding: '3px 8px',
                              color: col ? col.text : D.textSub,
                              fontWeight: state && state !== 'ok' ? '700' : '500',
                            }}>
                              {p.imageUrl && <img src={p.imageUrl} alt={p.productName} style={{ width: '14px', height: '14px', objectFit: 'cover', borderRadius: '3px' }} />}
                              {p.productName}
                              {p.allocatedUnits != null && (
                                <span style={{ opacity: 0.85 }}>· {p.usedUnits}/{p.allocatedUnits}</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </Link>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                    <Link to={`/portal/campaigns/${c.id}`} style={{ fontSize: '13px', color: D.accent, fontWeight: '700', textDecoration: 'none' }}>{t('campaigns.view')}</Link>
                    {canDelete && (
                      <>
                        <Form method="post">
                          <input type="hidden" name="intent" value={c.archived ? 'unarchive' : 'archive'} />
                          <input type="hidden" name="campaignId" value={c.id} />
                          <button type="submit"
                            style={{ background: 'none', border: `1px solid ${D.border}`, borderRadius: '6px', color: D.textMuted, cursor: 'pointer', fontSize: '12px', fontWeight: '600', padding: '4px 10px', whiteSpace: 'nowrap' }}>
                            {c.archived ? t('common.restore') : t('campaigns.archive')}
                          </button>
                        </Form>
                        {c.archived && (
                          <Form method="post" onSubmit={e => { if (!confirm(`Permanently delete "${c.title}"? This cannot be undone.`)) e.preventDefault(); }}>
                            <input type="hidden" name="intent" value="delete" />
                            <input type="hidden" name="campaignId" value={c.id} />
                            <button type="submit"
                              style={{ background: 'none', border: `1px solid ${D.errorText}`, borderRadius: '6px', color: D.errorText, cursor: 'pointer', fontSize: '12px', fontWeight: '600', padding: '4px 10px' }}>
                              {t('campaign.delete')}
                            </button>
                          </Form>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const labelStyle = {
  fontSize: '11px', fontWeight: '700', color: D.textMuted,
  textTransform: 'uppercase', letterSpacing: '0.6px',
  display: 'block', marginBottom: '6px',
};

const ALLOC_COLORS = {
  ok:   { bg: 'rgba(16,185,129,0.08)', text: '#10B981' },
  warn: { bg: 'rgba(245,158,11,0.10)', text: '#D97706' },
  over: { bg: 'rgba(239,68,68,0.08)',  text: '#DC2626' },
};
function allocState(used, allocated) {
  if (!allocated) return null;
  const pct = (used / allocated) * 100;
  if (pct >= 100) return 'over';
  if (pct >= 80)  return 'warn';
  return 'ok';
}
